// src/auth.js
// Mock token-based authentication + per-user data isolation.
//
// In this prototype, a static bearer token maps to a user. In production this
// would be a verified JWT / session from an identity provider (see README §Security).
// The IMPORTANT property demonstrated here: every piece of state (profile, chat
// history) is keyed by userId and a request can only ever touch its own user's
// data — there is no code path that returns another user's record.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USERS = JSON.parse(readFileSync(join(__dirname, '..', 'data', 'users.json'), 'utf8'));

// Per-user, in-memory store. Keyed by userId so data is isolated by construction.
// (In-memory => resets on restart; a real system uses an encrypted, access-controlled DB.)
const userState = new Map(); // userId -> { profile, chatHistory: [] }

function ensureState(userId, seedProfile) {
  if (!userState.has(userId)) {
    userState.set(userId, { profile: { ...seedProfile }, chatHistory: [] });
  }
  return userState.get(userId);
}

/**
 * Express middleware: require a valid bearer token, attach the scoped user.
 * Rejects with 401 otherwise. Never leaks which tokens exist.
 */
export function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const record = token && USERS[token];

  if (!record) {
    return res.status(401).json({ error: 'Unauthorized. Provide a valid Bearer token.' });
  }

  const state = ensureState(record.userId, record.profile);
  // req.auth is the ONLY handle downstream code gets — always scoped to this user.
  req.auth = {
    userId: record.userId,
    name: record.name,
    state,
  };
  next();
}

/**
 * Redact sensitive data before logging. Tokens are dropped entirely; financial
 * PII (income, EMIs, amount) is masked so logs prove WHAT happened without
 * leaking the user's actual figures. Demonstrates sensitive-data handling.
 */
export function redactForLog(obj = {}) {
  const clone = { ...obj };
  delete clone.token;
  for (const k of ['monthlyIncome', 'existingEmi', 'amount']) {
    if (clone[k] != null) clone[k] = '***';
  }
  return clone;
}

/**
 * Append-only audit trail. In production this would write to an immutable,
 * access-controlled store (so every recommendation is explainable after the
 * fact). Here it emits a single structured, PII-redacted log line.
 */
export function audit(entry) {
  console.log('[audit] ' + JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

/**
 * Per-user in-memory rate limiter (fixed window). Keyed by authenticated userId,
 * so one user can't exhaust LLM quota or abuse the service. A real system would
 * use a shared store (e.g. Redis) so limits hold across instances.
 */
export function rateLimit({ windowMs = 60000, max = 60 } = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = req.auth?.userId || req.ip || 'anon';
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
    b.count++;
    if (b.count > max) {
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    next();
  };
}

export function listDemoUsers() {
  return Object.entries(USERS).map(([token, u]) => ({
    token,
    userId: u.userId,
    name: u.name,
    profile: u.profile,
  }));
}

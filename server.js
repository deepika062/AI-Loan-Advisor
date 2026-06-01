// server.js
// Express API + static UI for the AI Loan Advisor Chatbot.
import './src/loadEnv.js';

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { authenticate, listDemoUsers, audit, rateLimit, redactForLog } from './src/auth.js';
import { buildRecommendation } from './src/recommend.js';
import { advise } from './src/advisor.js';
import { PRODUCTS } from './src/catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(join(__dirname, 'public')));

// ---- Public (no auth) -------------------------------------------------------

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Product catalog is public (marketing-style) info.
app.get('/api/products', (_req, res) => {
  res.json({
    products: PRODUCTS.map(({ id, name, description, baseRatePct, minAmount, maxAmount, minTenureMonths, maxTenureMonths }) => ({
      id, name, description, baseRatePct, minAmount, maxAmount, minTenureMonths, maxTenureMonths,
    })),
    note: 'Rates are illustrative mock data. Final rate depends on underwriting.',
  });
});

// Demo helper so the UI can show which tokens/users exist (prototype only).
app.get('/api/demo-users', (_req, res) => res.json({ users: listDemoUsers() }));

// ---- Authenticated (user-scoped) -------------------------------------------

// Authenticate first (so the rate limiter can key by userId), then rate-limit.
app.use('/api/me', authenticate, rateLimit({ windowMs: 60000, max: 60 }));

// Return the authenticated user's stored profile.
app.get('/api/me/profile', (req, res) => {
  res.json({ userId: req.auth.userId, name: req.auth.name, profile: req.auth.state.profile });
});

// Update (merge) the authenticated user's profile.
app.put('/api/me/profile', (req, res) => {
  req.auth.state.profile = { ...req.auth.state.profile, ...(req.body || {}) };
  res.json({ profile: req.auth.state.profile });
});

/**
 * Compute a deterministic recommendation for the user's request.
 * Body may include any of: amount, purpose, monthlyIncome, existingEmi,
 * preferredTenureMonths, employmentType, riskProfile, hasCollateral, hasExistingLoan.
 * Missing fields fall back to the stored profile.
 */
app.post('/api/me/recommend', (req, res) => {
  try {
    const merged = { ...req.auth.state.profile, ...(req.body || {}) };
    const facts = buildRecommendation(merged);
    // Persist the merged profile (scoped to this user only).
    req.auth.state.profile = { ...req.auth.state.profile, ...merged };
    audit({
      userId: req.auth.userId, action: 'recommend',
      recommended: facts.recommendation?.id ?? null,
      request: redactForLog(req.body || {}),
    });
    res.json(facts);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Conversational endpoint: compute fresh authoritative facts, then ask the LLM
 * to explain them in plain language. The LLM never sees another user's data.
 */
app.post('/api/me/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'message is required.' });

  try {
    const merged = { ...req.auth.state.profile, ...(req.body?.profile || {}) };
    const facts = buildRecommendation(merged);
    req.auth.state.profile = { ...req.auth.state.profile, ...merged };

    const history = req.auth.state.chatHistory;
    const traceId = randomUUID();
    const { reply, source, usage, language } = await advise(facts, message, {
      history,
      language: req.body?.language,
      metadata: { traceId, userId: req.auth.userId },
    });
    audit({
      userId: req.auth.userId, traceId, action: 'chat', source, language,
      recommended: facts.recommendation?.id ?? null,
    });

    // Append to this user's isolated history.
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: reply });
    if (history.length > 20) history.splice(0, history.length - 20);

    res.json({ reply, source, language, usage, facts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Loan Advisor running at http://localhost:${PORT}`);
});

export default app;

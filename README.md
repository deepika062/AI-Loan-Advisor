# LoanWise — AI Loan Advisor Chatbot

An AI-powered loan advisory assistant for a fintech lending context. It helps a
borrower understand available lending products, compare EMI/tenure options, and
choose a suitable product for their financial profile — with **responsible,
grounded, and transparent** guidance.

> **Assignment:** `SE_Case_10 — AI Loan Advisor Chatbot` (Fintech Lending AI case).
> Built as a runnable prototype with deterministic financial math + an LLM for
> natural-language explanation, via the provided LLM wrapper API.

---

## ✨ Core design principle (read this first)

**The LLM never computes or invents a number.**

Every financial figure — EMI, interest, total repayment, offered rate, FOIR,
eligibility outcome — is produced by **deterministic, unit-tested code**
(`src/emi.js`, `src/catalog.js`, `src/recommend.js`). Those results are passed to
the LLM as an **authoritative `CONTEXT` block**, and the model is instructed to use
*only* those facts, quote them *exactly*, and never guarantee approval.

This is the central hallucination safeguard: the AI handles *language*, the code
handles *truth*. If the LLM is unavailable, a deterministic template reply is used
instead, so the product never goes silent and never depends on the model for
correctness.

---

## 🏗️ Architecture

```
Browser (public/) ──HTTP──> Express (server.js)
                                  │
        ┌─────────────────────────┼──────────────────────────┐
        │                         │                           │
   auth.js                  recommend.js                  advisor.js
 (token → user,         (normalize profile,            (build grounded prompt,
  data isolation)        evaluate catalog,              call LLM, append fixed
                         compute EMI/FOIR, rank)         disclaimer, fallback)
        │                         │                           │
        │                    catalog.js + emi.js          llm.js ──HTTPS──> LLM wrapper API
        │                  (products, rules, math)
        └── per-user state: { profile, chatHistory }  (isolated by userId)
```

**Request flow for a chat turn:**
1. `authenticate` resolves the bearer token to a `userId` and attaches a
   **user-scoped** state object. No other user's data is reachable.
2. `buildRecommendation(profile)` deterministically evaluates every product,
   computes EMI + FOIR for eligible ones, and ranks them. → *authoritative facts.*
3. `advise(facts, message)` builds a strict grounding prompt, calls the LLM
   wrapper, and **appends a hard-coded compliance disclaimer** (so it can never be
   dropped by the model).
4. Reply + the recomputed facts are returned; the UI re-renders the cards so the
   numbers on screen always match the deterministic source of truth.

### Files
| File | Responsibility |
|---|---|
| `src/emi.js` | EMI / total interest / FOIR / tenure-comparison math (+ amortization preview). **Unit tested.** |
| `src/catalog.js` | Mock product catalog + hard eligibility rules + risk-based rate adjustment. |
| `src/recommend.js` | Input validation/normalization, eligibility evaluation, ranking → facts object. |
| `src/auth.js` | Mock bearer-token auth, per-user isolated state, PII-redacting audit log, rate limiter. |
| `src/llm.js` | Thin client for the LLM wrapper (`POST /llm/query`), timeout + error handling. |
| `src/advisor.js` | Grounding prompt, safeguards, fixed disclaimer, deterministic fallback, multilingual. |
| `server.js` | Express routes (public catalog + authenticated `/api/me/*`), audit logging, rate limiting. |
| `public/` | Single-page chat UI (sign-in, request form, recommendation cards, amortization preview, chat). |
| `test/emi.test.js` | Correctness tests for the financial math. |
| `test/recommend.test.js` | Tests for eligibility rules + recommendation ranking + validation. |

---

## 🚀 Run it

Requires **Node ≥ 18** (uses built-in `fetch`). Tested on Node 24.

```bash
npm install
npm start
# open http://localhost:3000
```

`.env` already contains the LLM wrapper URL + token and `PORT`. To run tests:

```bash
npm test
```

### Try it in the UI
1. Browse the **Available loan products** catalog (shown on load, no login needed).
2. Pick a **demo user** (e.g. *Alice (Salaried)*) — this fills the bearer token.
3. Click **Sign in** → your stored profile pre-fills the form.
4. Set a loan amount / purpose / tenure → **Get recommendation** (ranked cards +
   amortization preview + tenure trade-off).
5. Ask follow-ups in the chat: *"Why this product?"*, *"What if I pick a longer
   tenure?"*, *"Can I afford this?"*, *"Compare my top 2 options."* — switch
   language (e.g. हिन्दी), toggle 🔊, or ⬇ download the summary.

### Demo users (mock tokens)
| Token | User | Profile highlights |
|---|---|---|
| `tok_alice_123` | Alice | Salaried, ₹80k income, low risk, has existing loan |
| `tok_bob_456` | Bob | Self-employed, ₹45k income, has collateral |
| `tok_priya_789` | Priya | Business, ₹150k income, collateral + existing loan |

---

## 🔌 API

All financial endpoints are under `/api/me/*` and require `Authorization: Bearer <token>`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Liveness check. |
| `GET` | `/api/products` | Public product catalog (illustrative rates). |
| `GET` | `/api/demo-users` | Demo tokens/users (prototype convenience only). |
| `GET` | `/api/me/profile` | Authenticated user's stored profile. |
| `PUT` | `/api/me/profile` | Merge-update the profile. |
| `POST` | `/api/me/recommend` | Deterministic ranked recommendation for a request. |
| `POST` | `/api/me/chat` | Grounded conversational reply (`{ message, profile? }`). |

**Example:**
```bash
curl -X POST http://localhost:3000/api/me/chat \
  -H "Authorization: Bearer tok_alice_123" \
  -H "Content-Type: application/json" \
  -d '{"message":"Why this product?","profile":{"amount":500000,"preferredTenureMonths":36}}'
```

---

## 🧮 Financial logic

- **EMI** (reducing balance): `EMI = P·r·(1+r)^n / ((1+r)^n − 1)`, where
  `r = annualRate/12/100`, `n = months`. Zero-rate products (0% BNPL) split the
  principal evenly.
- **Total interest** = `EMI·n − P`. **Total repayment** = `EMI·n`.
- **FOIR / DTI** = `(existing EMIs + new EMI) / monthly income`. Loans whose FOIR
  exceeds **50%** are flagged as *high repayment stress* (still shown, with a clear
  warning — we inform rather than silently hide).
- **Risk profile** adjusts the offered rate: low `−1%`, medium `0`, high `+3%`
  (BNPL stays 0%, with a sane rate floor).

### Products & key eligibility gates (mock)
| Product | Base rate | Amount band | Tenure | Key gate |
|---|---|---|---|---|
| Personal Loan | 14% | 50k–20L | 12–60mo | income ≥ 25k |
| Salary Advance | 24% | 5k–2L | 1–3mo | salaried, ≤ 1× monthly income |
| BNPL | 0% | 1k–1L | 3–12mo | income ≥ 10k |
| SME Business Loan | 16% | 1L–1Cr | 12–84mo | self-employed/business |
| Top-up Loan | 12% | 50k–30L | 12–60mo | must have existing loan |
| Secured Loan | 10.5% | 1L–1.5Cr | 12–120mo | must have collateral |

**Ranking** (deterministic, explainable): affordable first → purpose match →
lowest total interest → lowest EMI.

---

## 🧠 Prompt strategy

The grounding prompt (`src/advisor.js`) has three parts:

1. **Role + strict rules** — use only `CONTEXT`; quote numbers exactly; never
   recalculate; never guarantee approval; don't recommend ineligible products;
   say "I don't have that" instead of inventing; no tax/legal/investment advice;
   be concise and transparent about trade-offs.
2. **`CONTEXT` (authoritative JSON)** — the borrower profile, obligation limit,
   the recommended product, all eligible products with computed EMI/FOIR, the
   ineligible products *with reasons*, and a short tenure trade-off illustration.
3. **Recent conversation + the user's message.**

The **disclaimer is appended in code**, not generated by the model, so a
compliance-critical statement can never be omitted or reworded.

---

## 🔐 Security & privacy

**In this prototype (mocked, as the brief allows):**
- Bearer-token auth; a token maps to exactly one `userId`.
- All state (profile, chat history) is keyed by `userId` and reachable only via
  the request's authenticated handle (`req.auth`). There is **no code path** that
  returns another user's data — isolation is by construction, not by filtering.
- The LLM only ever receives the *authenticated* user's facts; cross-user data
  never enters a prompt. A `traceId` + `userId` is attached as request metadata
  for auditability.
- Invalid/missing tokens get a generic `401` that doesn't reveal which tokens exist.
- **Audit log** (`audit()` in `src/auth.js`): every recommend/chat call emits a
  structured log line (userId, action, traceId, product recommended) with
  financial **PII masked** (`redactForLog` turns amount/income/EMI into `***`).
- **Rate limiting** (`rateLimit()`): 60 requests/min per authenticated user →
  `429` beyond that, so one user can't exhaust the shared LLM quota.

**In a real implementation we would add:**
- **Identity:** verified JWT / OAuth2 sessions from an IdP; short-lived tokens +
  refresh; per-request authZ (RBAC/ABAC), not just authN.
- **Data isolation:** row-level security keyed by user/tenant; encrypted store
  (at rest + in transit); strict tenant scoping on every query.
- **Sensitive data (PII / financial):** field-level encryption, tokenization of
  identifiers, data-minimization (don't store what isn't needed), configurable
  retention + right-to-erasure, and PII redaction before anything is logged or
  sent to a third-party model.
- **Model boundary:** send only the minimum derived facts to the LLM provider;
  prefer a data-processing-agreement / no-training endpoint; consider on-prem or
  VPC-hosted inference for regulated data.
- **Auditability:** persist the prototype's audit log to an immutable,
  access-controlled store (inputs → computed facts → reply), so any recommendation
  is explainable and reproducible after the fact.
- **Abuse/safety:** distributed rate limiting (shared store across instances),
  prompt-injection hardening (the grounding rules + code-owned math already blunt
  this), and output validation.

---

## ✅ Responsible-AI behaviour

- Numbers are deterministic and auditable — the model can't drift them.
- **Never** guarantees approval; every advisory reply carries the underwriting
  disclaimer (code-enforced).
- High-FOIR / unaffordable options are **flagged**, not hidden.
- Ineligible products are explained with concrete reasons.
- No tax/legal/investment advice; out-of-scope questions get an honest "I don't
  have that information."

---

## 🧪 Test cases

Automated — **15 tests, all passing** (`npm test`):

*Financial math* (`test/emi.test.js`):
- EMI matches the amortization formula for known values (₹1L @12%/12mo → ₹8,884.88).
- ₹5L @14%/60mo → ₹11,634.13.
- 0% BNPL splits principal evenly, zero interest.
- Longer tenure → lower EMI but higher total interest.
- FOIR computes debt-to-income correctly.
- Invalid inputs (zero/negative principal, non-integer tenure, negative rate) are rejected.

*Decision logic* (`test/recommend.test.js`):
- Salaried low-risk with existing loan → Top-up Loan wins on rate (11%).
- Eligible products are ranked by lowest total interest within the same tier.
- Unaffordable request (FOIR > 50%) is flagged, not silently approved.
- No eligible product for an over-large amount → every exclusion is explained.
- Salary Advance capped at ~1× monthly income.
- BNPL eligibility carries 0% interest.
- Collateral / employment gates enforced (Secured, SME).
- Profile validation rejects bad input.
- Tenure trade-off illustration is produced.

Manual scenarios verified against the running server:
1. **Alice, ₹5L general, 36mo** → Top-up Loan @11% (beats Personal @13% because of
   her existing-loan preferential rate); FOIR 30.46%; EMI ₹16,369.36 — and the LLM
   reply quotes those exact figures.
2. **"Am I 100% guaranteed approval?"** → assistant explicitly refuses to guarantee,
   explains underwriting dependence.
3. **₹90L on ₹12k income** → no eligible product; each exclusion explained with its
   reason, no fabricated offer.
4. **Cross-user isolation** → Alice updating her income to ₹999,999 does not change
   Bob's profile (still ₹45k); each token sees only its own data.
5. **Rate limit** → the 61st request within a minute returns `429`.
6. **Multilingual** → switching to Hindi returns the same grounded numbers
   (EMI ₹16,369.36, 11%) translated into Hindi.

---

## 📌 Assumptions & limitations

- All product rates, limits, and rules are **illustrative mock data**, not real offers.
- Per-user state is **in-memory** — it resets when the server restarts. A real
  system uses an encrypted, access-controlled database.
- Auth is mocked with static tokens (the brief permits simulated tokens).
- FOIR threshold (50%), risk-rate adjustments, and ranking weights are simplified,
  reasonable defaults — easily tunable in `catalog.js` / `recommend.js`.
- "Monthly income" for SME is treated as monthly business cash-flow.
- No real credit-bureau / KYC integration — that is the underwriting step the
  disclaimer points to.

---

## 🎁 Bonus features (all three implemented)
- **Multi-turn comparison** — chat keeps short per-user history; the UI offers
  "Compare my top 2 options" and re-renders cards on every turn.
- **Downloadable recommendation summary** — the "⬇ Download summary" button exports
  a styled, self-contained **HTML** document (request, recommended product,
  alternatives, excluded products with reasons, disclaimer). It renders ₹ and all
  text correctly and includes a "Print / Save as PDF" button. Built from the
  authoritative facts, so it always matches what's on screen. (A UTF-8 BOM is
  written so the file also opens cleanly in legacy editors like Notepad.)
- **Multilingual + voice simulation** — a language selector (English / Hindi /
  Spanish / French) instructs the LLM to reply in that language while keeping all
  numbers and product names exactly from `CONTEXT`; the compliance disclaimer uses
  **vetted in-code translations** (a legal artifact isn't left to the model). A
  "🔊 Speak replies" toggle and per-message speaker button read answers aloud via
  the browser's Web Speech API, with the correct voice locale per language.
- **Tenure trade-off illustration** — short-vs-long tenure EMI/interest comparison
  surfaced both in the UI and in `CONTEXT`.

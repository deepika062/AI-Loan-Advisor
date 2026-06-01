# 🎤 LoanWise — Interview Demo Cheat Sheet

Keep this open in a second window during the demo.

---

## 0. Start (do this BEFORE the call)
```bash
cd c:\Users\Admin\Assignment
npm install        # once
npm start          # → http://localhost:3000
```
Open the browser, **hard-refresh (Ctrl+F5)**. Have `npm test` ready in a second terminal.

**One-line pitch:** *"LoanWise is an AI loan advisor where all the financial math is deterministic, tested code, and the LLM only explains those pre-computed numbers — so it's accurate, auditable, and can't hallucinate rates or guarantee approval."*

---

## 1. Demo click-path (≈4 minutes — tell it as a story)

1. **Catalog first** → "Before logging in, anyone can browse the 6 mock products with their rate bands and tenures." (scroll the right panel)
2. **Sign in** → pick *Alice (Salaried)* → Sign in. "Each token maps to one user; her stored profile pre-fills."
3. **Request** → Amount `500000`, Purpose `General`, Tenure `36` → **Get recommendation**.
   - Point at the cards: *"Top pick is **Top-up Loan @11%**, EMI **₹16,369.36**, and it beats the Personal Loan at 13% because of her existing-loan preferential rate."*
   - Expand **View amortization** → "principal vs interest split per month."
   - Point at **tenure trade-off** line and **Why excluded (reasons)**.
4. **Chat** → ask *"Why this product over a personal loan?"*
   - *"Notice the AI quotes the exact same numbers — because it's only explaining the grounded CONTEXT, not calculating."*
5. **Safeguard** → ask *"Am I 100% guaranteed approval?"* → "It refuses to guarantee and points to underwriting. The disclaimer is added by code, every time."
6. **Bonuses** → switch language to **हिन्दी** (same numbers, Hindi prose) → toggle **🔊** → click **⬇ Download summary** (HTML → Print/Save as PDF).
7. **Sign out** → "Session clears; data is per-user."

---

## 2. Architecture (say this in 20 seconds)
*"Vanilla front-end → Express API. A request is authenticated and scoped to a user, then `recommend.js` deterministically evaluates the catalog, computes EMI + FOIR, and ranks products. That authoritative 'facts' object is passed to `advisor.js`, which builds a strict grounding prompt, calls the LLM wrapper, and appends a fixed disclaimer. The math is in `emi.js`/`catalog.js`/`recommend.js`; the LLM only does language."*

**Files:** `emi.js` (math) · `catalog.js` (products + rules) · `recommend.js` (eligibility + ranking) · `auth.js` (token/isolation/audit/rate-limit) · `llm.js` (wrapper client) · `advisor.js` (grounding + disclaimer + fallback) · `server.js` (routes) · `public/` (UI) · `test/` (15 tests).

---

## 3. Maps to the 5 evaluation criteria
- **Conversational UX / clarity** → catalog, ranked cards, amortization, trade-off, suggested questions.
- **Calculation correctness** → reducing-balance EMI; **15 passing tests** (`npm test`).
- **AI grounding / anti-hallucination** → LLM never computes; uses only CONTEXT; quotes exactly; deterministic fallback if LLM down.
- **Responsible AI** → never guarantees approval; **code-enforced** disclaimer; high-FOIR flagged not hidden; no tax/legal advice.
- **Security / privacy** → token→userId isolation by construction; PII-redacted audit log; rate limiting; generic 401.

---

## 4. Likely questions → crisp answers

**Q: How do you stop the AI from inventing/wrong numbers?**
> All EMIs, rates, totals, and FOIR come from deterministic, unit-tested code and are passed to the model as an authoritative CONTEXT block. The prompt forbids recalculating and tells it to quote exactly. So the model handles wording, the code owns truth.

**Q: What if the LLM is down or slow?**
> `advise()` has a timeout and a deterministic template fallback — the user still gets the correct recommendation and disclaimer, just without the conversational prose. It never fails silently.

**Q: How is the EMI calculated?**
> Standard reducing-balance amortization: `EMI = P·r·(1+r)ⁿ / ((1+r)ⁿ − 1)`, `r = annualRate/12/100`, `n = months`. Zero-rate products (0% BNPL) split principal evenly. Total interest = EMI·n − P.

**Q: How do you decide eligibility and ranking?**
> Hard gates per product (income, amount band, tenure band, employment, collateral/existing-loan). Affordability uses **FOIR** = (existing + new EMI) / income, capped at 50%. Ranking: affordable first → purpose match → lowest total interest → lowest EMI. All deterministic and explainable.

**Q: How is user data isolated? (security)**
> A bearer token maps to a userId; state (profile + chat history) is keyed by userId and the only handle downstream code gets is the authenticated `req.auth` — there's no code path that returns another user's data. Plus a PII-redacted audit log and per-user rate limiting. I demoed this: Alice's data never appears for Bob.

**Q: It's mocked — what would production look like?**
> Verified JWT/OAuth sessions + RBAC; row-level security per tenant; field-level encryption + tokenization of PII; data minimization + retention/erasure; send only minimal derived facts to a no-training model endpoint; immutable audit store; distributed rate limiting. (All listed in README §Security.)

**Q: What's your prompt strategy?**
> Three parts: (1) role + strict rules (use only CONTEXT, quote exactly, never guarantee approval, no tax/legal advice), (2) the authoritative CONTEXT JSON, (3) recent history + the user message. The disclaimer is appended in code, not by the model, so it can't be dropped.

**Q: Edge cases / failure modes you handled?**
> No eligible product (every exclusion explained, nothing fabricated); unaffordable request (flagged, not hidden); invalid input (validated → 400); tenure outside a product's band (clamped); LLM failure (fallback); missing TTS voice (graceful warning).

**Q: What would you improve with more time?**
> Persist state to an encrypted DB (currently in-memory), full multi-turn memory, a PDF export library, and richer credit-risk modelling. I deliberately kept scope tight per the brief's "clarity over complexity."

---

## 5. Honest limitations (say these proactively — it reads as maturity)
- Mock rates/rules; not real offers. In-memory state resets on restart. Auth is mocked tokens.
- Chat needs internet (hosted LLM); deterministic parts work offline.
- Hindi **voice** needs an OS TTS voice installed (this machine has only English) — Hindi **text** works perfectly; that's enough for the "voice OR multilingual" bonus.

---

## 6. Numbers to remember
- **Alice, ₹5,00,000, 36mo, general → Top-up Loan @11%, EMI ₹16,369.36, FOIR 30.46%.**
- FOIR cap **50%**. Risk: low −1%, medium 0, high +3%. BNPL 0%.
- **15 tests pass.** Rate limit **60/min/user**.

// test/recommend.test.js
// Tests for eligibility rules + recommendation ranking (the decision logic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendation, normalizeProfile } from '../src/recommend.js';

const salariedBase = {
  amount: 500000, purpose: 'general', monthlyIncome: 80000, existingEmi: 8000,
  preferredTenureMonths: 36, employmentType: 'salaried', riskProfile: 'low',
  hasCollateral: false, hasExistingLoan: true,
};

test('Salaried low-risk with existing loan → Top-up Loan wins on rate', () => {
  const f = buildRecommendation(salariedBase);
  assert.equal(f.recommendation.id, 'top_up_loan');     // 12% base −1% risk = 11%, beats Personal 13%
  assert.equal(f.recommendation.offeredRatePct, 11);
  const ids = f.eligible.map((e) => e.id);
  assert.ok(ids.includes('personal_loan'));
  assert.ok(f.recommendation.affordable);                // FOIR well within 50%
});

test('Eligible products are ranked by lowest total interest (within same affordability/purpose tier)', () => {
  const f = buildRecommendation(salariedBase);
  const affordable = f.eligible.filter((e) => e.affordable && e.purposeMatch);
  for (let i = 1; i < affordable.length; i++) {
    assert.ok(affordable[i - 1].totalInterest <= affordable[i].totalInterest);
  }
});

test('Unaffordable request is flagged (high FOIR), not silently approved', () => {
  const f = buildRecommendation({
    ...salariedBase, monthlyIncome: 20000, existingEmi: 0, hasExistingLoan: false,
  });
  // Top pick exists but should be marked unaffordable (FOIR > 50%).
  assert.ok(f.recommendation);
  assert.equal(f.recommendation.affordable, false);
  assert.ok(f.recommendation.foirPct > 50);
});

test('No eligible product when income is far too low for the amount', () => {
  const f = buildRecommendation({
    amount: 9000000, monthlyIncome: 12000, purpose: 'general',
    employmentType: 'salaried', preferredTenureMonths: 24,
  });
  assert.equal(f.recommendation, null);
  assert.equal(f.eligible.length, 0);
  assert.ok(f.ineligible.length >= 1);
  assert.ok(f.ineligible.every((p) => p.reasons.length > 0)); // every exclusion is explained
});

test('Salary Advance is capped at ~1× monthly income', () => {
  const f = buildRecommendation({
    amount: 50000, monthlyIncome: 30000, purpose: 'emergency',
    employmentType: 'salaried', preferredTenureMonths: 2,
  });
  const sa = f.ineligible.find((p) => p.id === 'salary_advance');
  assert.ok(sa, 'salary advance should be ineligible');
  assert.ok(sa.reasons.some((r) => /Maximum loan amount/i.test(r)));
});

test('BNPL eligible for a small purchase carries 0% interest', () => {
  const f = buildRecommendation({
    amount: 30000, monthlyIncome: 20000, purpose: 'shopping',
    employmentType: 'salaried', preferredTenureMonths: 6,
  });
  const bnpl = f.eligible.find((e) => e.id === 'bnpl');
  assert.ok(bnpl, 'BNPL should be eligible');
  assert.equal(bnpl.offeredRatePct, 0);
  assert.equal(bnpl.totalInterest, 0);
});

test('Secured Loan requires collateral; SME requires business/self-employed', () => {
  const noCollateral = buildRecommendation({
    ...salariedBase, hasCollateral: false,
  });
  assert.ok(noCollateral.ineligible.find((p) => p.id === 'secured_loan'));

  const salariedSme = buildRecommendation({ ...salariedBase });
  assert.ok(salariedSme.ineligible.find((p) => p.id === 'sme_loan'));
});

test('normalizeProfile rejects invalid input', () => {
  assert.throws(() => normalizeProfile({ amount: 0, monthlyIncome: 50000 }));
  assert.throws(() => normalizeProfile({ amount: 100000, monthlyIncome: 0 }));
  assert.throws(() => normalizeProfile({ amount: 100000, monthlyIncome: 50000, employmentType: 'wizard' }));
  assert.throws(() => normalizeProfile({ amount: 100000, monthlyIncome: 50000, riskProfile: 'reckless' }));
});

test('Tenure trade-off illustration is provided for the top pick', () => {
  const f = buildRecommendation(salariedBase);
  assert.ok(f.tenureTradeoff);
  // Longer tenure → lower EMI but higher total interest.
  assert.ok(f.tenureTradeoff.a.emi > f.tenureTradeoff.b.emi);
  assert.ok(f.tenureTradeoff.a.totalInterest < f.tenureTradeoff.b.totalInterest);
});

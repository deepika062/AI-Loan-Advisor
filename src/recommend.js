// src/recommend.js
// Recommendation engine: normalize the borrower's request, evaluate every product,
// compute deterministic EMI/FOIR for the eligible ones, and rank them.
//
// Output of buildRecommendation() is the AUTHORITATIVE "facts" object that gets
// grounded into the LLM. The LLM may rephrase it but must never contradict it.

import { PRODUCTS, evaluateEligibility, MAX_FOIR } from './catalog.js';
import { calculateEMI, calculateFOIR, compareTenures, round2 } from './emi.js';

const EMPLOYMENT_TYPES = ['salaried', 'self_employed', 'business'];
const RISK_PROFILES = ['low', 'medium', 'high'];

/**
 * Validate + normalize raw user input into a clean profile object.
 * Throws a descriptive Error for invalid input (caught by the API layer).
 */
export function normalizeProfile(input = {}) {
  const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`"${name}" must be a number.`);
    return n;
  };

  const amount = num(input.amount, 'amount');
  const monthlyIncome = num(input.monthlyIncome, 'monthlyIncome');
  const existingEmi = input.existingEmi == null ? 0 : num(input.existingEmi, 'existingEmi');
  const preferredTenureMonths =
    input.preferredTenureMonths == null ? null : num(input.preferredTenureMonths, 'preferredTenureMonths');

  if (amount <= 0) throw new Error('Loan amount must be greater than 0.');
  if (monthlyIncome <= 0) throw new Error('Monthly income must be greater than 0.');
  if (existingEmi < 0) throw new Error('Existing EMI cannot be negative.');

  const employmentType = String(input.employmentType || 'salaried').toLowerCase();
  if (!EMPLOYMENT_TYPES.includes(employmentType)) {
    throw new Error(`employmentType must be one of: ${EMPLOYMENT_TYPES.join(', ')}.`);
  }

  const riskProfile = String(input.riskProfile || 'medium').toLowerCase();
  if (!RISK_PROFILES.includes(riskProfile)) {
    throw new Error(`riskProfile must be one of: ${RISK_PROFILES.join(', ')}.`);
  }

  return {
    amount,
    monthlyIncome,
    existingEmi,
    preferredTenureMonths,
    employmentType,
    riskProfile,
    purpose: String(input.purpose || 'general').toLowerCase(),
    hasCollateral: Boolean(input.hasCollateral),
    hasExistingLoan: Boolean(input.hasExistingLoan) || existingEmi > 0,
  };
}

/**
 * Pick a tenure to quote for a product: the borrower's preference if it fits the
 * product's band, otherwise clamp into the band.
 */
function resolveTenure(product, preferred) {
  if (preferred == null) {
    // Default to a middle-of-band tenure rounded to whole months.
    return Math.round((product.minTenureMonths + product.maxTenureMonths) / 2);
  }
  return Math.min(product.maxTenureMonths, Math.max(product.minTenureMonths, Math.round(preferred)));
}

/**
 * Build the full, ranked recommendation for a borrower profile.
 * @returns authoritative facts object.
 */
export function buildRecommendation(rawProfile) {
  const profile = normalizeProfile(rawProfile);
  const eligible = [];
  const ineligible = [];

  for (const product of PRODUCTS) {
    const elig = evaluateEligibility(product, profile);
    if (!elig.eligible) {
      ineligible.push({ id: product.id, name: product.name, reasons: elig.reasons });
      continue;
    }

    const tenure = resolveTenure(product, profile.preferredTenureMonths);
    const tenureAdjusted = tenure !== profile.preferredTenureMonths && profile.preferredTenureMonths != null;
    const emi = calculateEMI(profile.amount, elig.offeredRatePct, tenure);
    const foir = calculateFOIR(profile.monthlyIncome, profile.existingEmi, emi.emi);
    const affordable = foir.foir <= MAX_FOIR;

    eligible.push({
      id: product.id,
      name: product.name,
      description: product.description,
      offeredRatePct: elig.offeredRatePct,
      tenureMonths: tenure,
      tenureAdjusted,
      purposeMatch: elig.purposeMatch,
      emi: emi.emi,
      totalInterest: emi.totalInterest,
      totalPayment: emi.totalPayment,
      schedulePreview: emi.schedulePreview,
      foirPct: foir.foirPct,
      disposableIncome: foir.disposableIncome,
      affordable,
      affordabilityNote: affordable
        ? `Within the ${Math.round(MAX_FOIR * 100)}% obligation limit.`
        : `Exceeds the ${Math.round(MAX_FOIR * 100)}% obligation limit (FOIR ${foir.foirPct}%). High repayment stress.`,
    });
  }

  // Ranking: affordable first, then purpose match, then lowest total interest,
  // then lowest EMI. Deterministic and explainable.
  eligible.sort((a, b) => {
    if (a.affordable !== b.affordable) return a.affordable ? -1 : 1;
    if (a.purposeMatch !== b.purposeMatch) return a.purposeMatch ? -1 : 1;
    if (a.totalInterest !== b.totalInterest) return a.totalInterest - b.totalInterest;
    return a.emi - b.emi;
  });

  const top = eligible[0] || null;

  // Tenure trade-off illustration for the top pick (short vs long within band).
  let tenureTradeoff = null;
  if (top) {
    const product = PRODUCTS.find((p) => p.id === top.id);
    const shortT = product.minTenureMonths;
    const longT = product.maxTenureMonths;
    if (shortT !== longT) {
      tenureTradeoff = compareTenures(profile.amount, top.offeredRatePct, shortT, longT);
    }
  }

  return {
    profile,
    constants: { maxFoirPct: Math.round(MAX_FOIR * 100) },
    eligible,
    ineligible,
    recommendation: top,
    tenureTradeoff,
    generatedSummary: top
      ? `${top.name} at ${top.offeredRatePct}% for ${top.tenureMonths} months: EMI ₹${top.emi.toLocaleString('en-IN')}, total interest ₹${top.totalInterest.toLocaleString('en-IN')}.`
      : 'No product currently matches this profile.',
  };
}

export { round2 };

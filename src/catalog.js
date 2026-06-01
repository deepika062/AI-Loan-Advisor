// src/catalog.js
// Mock lending product catalog + eligibility rules.
// All rates/limits are illustrative mock data for the prototype — NOT real offers.
//
// Each product has hard eligibility gates (income, amount band, tenure band,
// employment, collateral/existing-loan prerequisites) and a base rate that the
// recommendation engine adjusts for the borrower's risk profile.

export const PRODUCTS = [
  {
    id: 'personal_loan',
    name: 'Personal Loan',
    description: 'Unsecured general-purpose loan for any personal need.',
    baseRatePct: 14,
    minAmount: 50000,
    maxAmount: 2000000,
    minTenureMonths: 12,
    maxTenureMonths: 60,
    minMonthlyIncome: 25000,
    allowedEmployment: ['salaried', 'self_employed'],
    requiresCollateral: false,
    requiresExistingLoan: false,
    purposes: ['general', 'medical', 'travel', 'wedding', 'education', 'debt_consolidation'],
  },
  {
    id: 'salary_advance',
    name: 'Salary Advance',
    description: 'Very short-term advance against your next salary. Fast, small, high rate.',
    baseRatePct: 24,
    minAmount: 5000,
    maxAmount: 200000,
    minTenureMonths: 1,
    maxTenureMonths: 3,
    minMonthlyIncome: 15000,
    allowedEmployment: ['salaried'],
    requiresCollateral: false,
    requiresExistingLoan: false,
    // Capped at ~1x monthly income; enforced dynamically in eligibility().
    maxMultipleOfIncome: 1,
    purposes: ['emergency', 'general', 'medical'],
  },
  {
    id: 'bnpl',
    name: 'Buy Now Pay Later (BNPL)',
    description: 'Split a purchase into small installments. 0% if repaid within the plan.',
    baseRatePct: 0,
    minAmount: 1000,
    maxAmount: 100000,
    minTenureMonths: 3,
    maxTenureMonths: 12,
    minMonthlyIncome: 10000,
    allowedEmployment: ['salaried', 'self_employed'],
    requiresCollateral: false,
    requiresExistingLoan: false,
    purposes: ['shopping', 'electronics', 'general'],
  },
  {
    id: 'sme_loan',
    name: 'SME Business Loan',
    description: 'Working-capital / growth loan for small and medium businesses.',
    baseRatePct: 16,
    minAmount: 100000,
    maxAmount: 10000000,
    minTenureMonths: 12,
    maxTenureMonths: 84,
    minMonthlyIncome: 50000, // interpreted as monthly business cash-flow
    allowedEmployment: ['self_employed', 'business'],
    requiresCollateral: false,
    requiresExistingLoan: false,
    purposes: ['business', 'working_capital', 'expansion', 'general'],
  },
  {
    id: 'top_up_loan',
    name: 'Top-up Loan',
    description: 'Additional loan on top of an existing loan, at a preferential rate.',
    baseRatePct: 12,
    minAmount: 50000,
    maxAmount: 3000000,
    minTenureMonths: 12,
    maxTenureMonths: 60,
    minMonthlyIncome: 25000,
    allowedEmployment: ['salaried', 'self_employed', 'business'],
    requiresCollateral: false,
    requiresExistingLoan: true, // only if the borrower already has a loan
    purposes: ['general', 'home_improvement', 'debt_consolidation', 'business'],
  },
  {
    id: 'secured_loan',
    name: 'Secured Loan (against collateral)',
    description: 'Lower-rate loan backed by collateral (property, deposit, gold, etc.).',
    baseRatePct: 10.5,
    minAmount: 100000,
    maxAmount: 15000000,
    minTenureMonths: 12,
    maxTenureMonths: 120,
    minMonthlyIncome: 20000,
    allowedEmployment: ['salaried', 'self_employed', 'business'],
    requiresCollateral: true, // only if the borrower has pledgeable collateral
    requiresExistingLoan: false,
    purposes: ['general', 'business', 'education', 'home_improvement', 'debt_consolidation'],
  },
];

// Risk profile adjusts the offered rate (in percentage points) on top of base.
export const RISK_RATE_ADJUSTMENT = {
  low: -1.0,
  medium: 0,
  high: 3.0,
};

// Maximum share of monthly income that total EMIs may consume (FOIR cap).
export const MAX_FOIR = 0.5;

export function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}

/**
 * Determine the rate offered to a borrower for a product, given risk profile.
 * Rate never goes below a sane floor.
 */
export function offeredRate(product, riskProfile = 'medium') {
  const adj = RISK_RATE_ADJUSTMENT[riskProfile] ?? 0;
  // BNPL stays 0% regardless of risk band.
  if (product.baseRatePct === 0) return 0;
  return Math.max(6, product.baseRatePct + adj);
}

/**
 * Evaluate hard eligibility gates for a single product against a borrower profile.
 * Returns the offered rate when eligible, plus a list of human-readable reasons
 * for any failures (used for transparency in the UI and LLM grounding).
 *
 * @param {object} product
 * @param {object} profile - normalized borrower profile (see recommend.js)
 * @returns {{ eligible:boolean, reasons:string[], offeredRatePct:number, effectiveMaxAmount:number }}
 */
export function evaluateEligibility(product, profile) {
  const reasons = [];
  const {
    amount, monthlyIncome, employmentType, hasCollateral,
    hasExistingLoan, purpose, riskProfile,
  } = profile;

  if (!product.allowedEmployment.includes(employmentType)) {
    reasons.push(
      `Not available for employment type "${employmentType}" (allowed: ${product.allowedEmployment.join(', ')}).`
    );
  }

  if (monthlyIncome < product.minMonthlyIncome) {
    reasons.push(
      `Requires minimum monthly income of ₹${product.minMonthlyIncome.toLocaleString('en-IN')} (you entered ₹${monthlyIncome.toLocaleString('en-IN')}).`
    );
  }

  // Effective max amount can be tightened by income-multiple caps (salary advance).
  let effectiveMaxAmount = product.maxAmount;
  if (product.maxMultipleOfIncome) {
    effectiveMaxAmount = Math.min(
      product.maxAmount,
      product.maxMultipleOfIncome * monthlyIncome
    );
  }

  if (amount < product.minAmount) {
    reasons.push(`Minimum loan amount is ₹${product.minAmount.toLocaleString('en-IN')}.`);
  }
  if (amount > effectiveMaxAmount) {
    reasons.push(`Maximum loan amount for you is ₹${effectiveMaxAmount.toLocaleString('en-IN')}.`);
  }

  if (product.requiresCollateral && !hasCollateral) {
    reasons.push('Requires pledgeable collateral, which is not on your profile.');
  }
  if (product.requiresExistingLoan && !hasExistingLoan) {
    reasons.push('Available only as a top-up on an existing loan.');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    offeredRatePct: offeredRate(product, riskProfile),
    effectiveMaxAmount,
    purposeMatch: product.purposes.includes(purpose),
  };
}

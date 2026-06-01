// src/emi.js
// Deterministic loan math. This module is the single source of truth for every
// number the system reports. The LLM is NEVER allowed to compute or alter these
// values — it only explains them. Keeping the math here makes results auditable,
// testable, and reproducible.

/**
 * Round to 2 decimals using a half-up rule, avoiding binary float drift.
 */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Calculate the Equated Monthly Installment (EMI) using the standard
 * reducing-balance amortization formula:
 *
 *        P * r * (1 + r)^n
 *  EMI = -----------------------
 *         (1 + r)^n - 1
 *
 * where:
 *   P = principal (loan amount)
 *   r = monthly interest rate = annualRatePct / 12 / 100
 *   n = tenure in months
 *
 * Special case: r == 0 (e.g. 0% BNPL) => EMI = P / n.
 *
 * @param {number} principal       Loan amount (positive).
 * @param {number} annualRatePct   Annual interest rate as a percentage, e.g. 14 for 14%.
 * @param {number} tenureMonths    Number of monthly installments (positive integer).
 * @returns {{
 *   emi: number, totalPayment: number, totalInterest: number,
 *   principal: number, annualRatePct: number, tenureMonths: number,
 *   schedulePreview: Array<{month:number, principal:number, interest:number, balance:number}>
 * }}
 */
export function calculateEMI(principal, annualRatePct, tenureMonths) {
  if (!(principal > 0)) throw new Error('principal must be > 0');
  if (annualRatePct < 0) throw new Error('annualRatePct must be >= 0');
  if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) {
    throw new Error('tenureMonths must be a positive integer');
  }

  const r = annualRatePct / 12 / 100;

  let emi;
  if (r === 0) {
    emi = principal / tenureMonths;
  } else {
    const pow = Math.pow(1 + r, tenureMonths);
    emi = (principal * r * pow) / (pow - 1);
  }

  const totalPayment = emi * tenureMonths;
  const totalInterest = totalPayment - principal;

  return {
    principal: round2(principal),
    annualRatePct,
    tenureMonths,
    emi: round2(emi),
    totalPayment: round2(totalPayment),
    totalInterest: round2(totalInterest),
    schedulePreview: amortizationPreview(principal, r, emi, tenureMonths),
  };
}

/**
 * First few rows of the amortization schedule, for transparency in the UI.
 * Returns up to `maxRows` months.
 */
function amortizationPreview(principal, monthlyRate, emi, tenureMonths, maxRows = 3) {
  const rows = [];
  let balance = principal;
  const n = Math.min(maxRows, tenureMonths);
  for (let m = 1; m <= n; m++) {
    const interest = balance * monthlyRate;
    const principalPaid = emi - interest;
    balance = Math.max(0, balance - principalPaid);
    rows.push({
      month: m,
      principal: round2(principalPaid),
      interest: round2(interest),
      balance: round2(balance),
    });
  }
  return rows;
}

/**
 * Fixed Obligation to Income Ratio (FOIR / DTI).
 * Lenders cap the share of monthly income consumed by debt obligations.
 *
 * FOIR = (existing monthly EMIs + proposed new EMI) / monthly income
 *
 * @returns {{ foir:number, foirPct:number, disposableIncome:number }}
 */
export function calculateFOIR(monthlyIncome, existingEmi, newEmi) {
  if (!(monthlyIncome > 0)) throw new Error('monthlyIncome must be > 0');
  const totalObligations = existingEmi + newEmi;
  const foir = totalObligations / monthlyIncome;
  return {
    foir: round2(foir),
    foirPct: round2(foir * 100),
    disposableIncome: round2(monthlyIncome - totalObligations),
  };
}

/**
 * Compare two tenures for the same principal+rate, to explain the classic
 * trade-off: longer tenure => lower EMI but higher total interest.
 */
export function compareTenures(principal, annualRatePct, tenureA, tenureB) {
  const a = calculateEMI(principal, annualRatePct, tenureA);
  const b = calculateEMI(principal, annualRatePct, tenureB);
  return {
    a: { tenureMonths: tenureA, emi: a.emi, totalInterest: a.totalInterest },
    b: { tenureMonths: tenureB, emi: b.emi, totalInterest: b.totalInterest },
    emiDifference: round2(a.emi - b.emi),
    interestDifference: round2(a.totalInterest - b.totalInterest),
  };
}

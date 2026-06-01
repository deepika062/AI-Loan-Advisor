// test/emi.test.js
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateEMI, calculateFOIR, compareTenures, round2 } from '../src/emi.js';

test('EMI matches the standard amortization formula (₹1,00,000 @ 12% for 12mo)', () => {
  // Known reference value: ~8884.88 / month
  const r = calculateEMI(100000, 12, 12);
  assert.equal(r.emi, 8884.88);
  // Totals derive from the full-precision EMI; interest = total - principal.
  assert.ok(Math.abs(r.totalPayment - r.emi * 12) < 0.05);
  assert.equal(r.totalInterest, round2(r.totalPayment - 100000));
});

test('EMI for ₹5,00,000 @ 14% for 60mo (~11,633)', () => {
  const r = calculateEMI(500000, 14, 60);
  assert.equal(r.emi, 11634.13);
  assert.ok(r.totalInterest > 0);
});

test('Zero-interest (0% BNPL) splits principal evenly', () => {
  const r = calculateEMI(12000, 0, 6);
  assert.equal(r.emi, 2000);
  assert.equal(r.totalInterest, 0);
  assert.equal(r.totalPayment, 12000);
});

test('Longer tenure lowers EMI but raises total interest', () => {
  const c = compareTenures(500000, 14, 24, 60);
  assert.ok(c.a.emi > c.b.emi, 'shorter tenure has higher EMI');
  assert.ok(c.a.totalInterest < c.b.totalInterest, 'shorter tenure has lower interest');
});

test('FOIR computes debt-to-income correctly', () => {
  const f = calculateFOIR(50000, 5000, 10000);
  assert.equal(f.foirPct, 30); // (5000+10000)/50000 = 0.30
  assert.equal(f.disposableIncome, 35000);
});

test('Invalid inputs are rejected', () => {
  assert.throws(() => calculateEMI(0, 12, 12));
  assert.throws(() => calculateEMI(100000, 12, 0));
  assert.throws(() => calculateEMI(100000, -1, 12));
  assert.throws(() => calculateEMI(100000, 12, 12.5));
});

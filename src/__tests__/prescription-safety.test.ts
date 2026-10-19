import assert from "node:assert/strict";
import { calcDispenseQty, VALID_FREQUENCIES, VALID_ROUTES } from "../controllers/prescription.controller.js";

console.log("=== Running Prescription Safety & Calculation Unit Tests ===\n");

// Test 1: STAT Medication Safety (Immediate dose, must NEVER multiply by duration)
console.log("Test 1: STAT Immediate Dose Safety");
const statItem1 = calcDispenseQty({ frequency: "STAT", dosageAmount: "1", duration: "14 days" });
assert.equal(statItem1, 1, "STAT with 1 unit over 14 days should dispense exactly 1");

const statItem2 = calcDispenseQty({ frequency: "STAT", dosageAmount: "2", duration: "30 days" });
assert.equal(statItem2, 2, "STAT with 2 units over 30 days should dispense exactly 2 (single immediate dose)");

const statItem3 = calcDispenseQty({ frequency: "STAT", tabletsPerTime: 3, duration: "7 days" });
assert.equal(statItem3, 3, "STAT with tabletsPerTime=3 should dispense exactly 3");
console.log("✔ PASS: STAT correctly treated as immediate single dose, ignoring duration multiplier.\n");

// Test 2: EOD (Every Other Day) alternate schedule calculation
console.log("Test 2: EOD Alternate Days Schedule");
const eodItem1 = calcDispenseQty({ frequency: "EOD", dosageAmount: "1", duration: "10 days" });
assert.equal(eodItem1, 5, "EOD for 10 days at 1 tablet per dose should be 5 doses");

const eodItem2 = calcDispenseQty({ frequency: "EOD", dosageAmount: "2", duration: "7 days" });
assert.equal(eodItem2, 8, "EOD for 7 days at 2 tablets per dose should be Math.ceil(7/2)*2 = 8");
console.log("✔ PASS: EOD correctly calculates alternate day doses.\n");

// Test 3: Standard Canonical Frequencies (OD, BD, TDS, QDS/QID)
console.log("Test 3: Standard Canonical Frequencies");
const odItem = calcDispenseQty({ frequency: "OD", dosageAmount: "1", duration: "7 days" });
assert.equal(odItem, 7, "OD 1 tab for 7 days should be 7");

const bdItem = calcDispenseQty({ frequency: "BD", dosageAmount: "1", duration: "5 days" });
assert.equal(bdItem, 10, "BD 1 tab for 5 days should be 10");

const tdsItem = calcDispenseQty({ frequency: "TDS", dosageAmount: "2", duration: "3 days" });
assert.equal(tdsItem, 18, "TDS 2 tabs for 3 days should be 18");

const qdsItem = calcDispenseQty({ frequency: "QDS", dosageAmount: "1", duration: "4 days" });
assert.equal(qdsItem, 16, "QDS 1 tab for 4 days should be 16");

const qidItem = calcDispenseQty({ frequency: "QID", dosageAmount: "1", duration: "2 days" });
assert.equal(qidItem, 8, "QID 1 tab for 2 days should be 8");
console.log("✔ PASS: Standard canonical frequencies calculate accurately.\n");

// Test 4: Clinician Explicit Quantity Override
console.log("Test 4: Clinician Explicit Quantity Override");
const overrideItem1 = calcDispenseQty({ frequency: "OD", dosageAmount: "1", duration: "30 days", quantity: 15 });
assert.equal(overrideItem1, 15, "Explicit quantity of 15 should override auto-calculated 30");

const overrideItem2 = calcDispenseQty({ frequency: "BD", duration: "10 days", dispenseQty: 12 });
assert.equal(overrideItem2, 12, "Explicit dispenseQty of 12 should override auto-calculated 20");
console.log("✔ PASS: Clinician explicit quantity overrides are strictly respected.\n");

// Test 5: Fractional / Half Tablet Dosing (e.g. 0.5 tablets)
console.log("Test 5: Fractional Dosing Calculation (e.g. 0.5 tablets)");
const halfTabBd = calcDispenseQty({ frequency: "BD", dosageAmount: "0.5", duration: "5 days" });
assert.equal(halfTabBd, 5, "BD with 0.5 tablets for 5 days must calculate exactly: 0.5 * 2 * 5 = 5 units");

const halfTabOd = calcDispenseQty({ frequency: "OD", dosageAmount: "0.5", duration: "5 days" });
assert.equal(halfTabOd, 3, "OD with 0.5 tablets for 5 days: 0.5 * 1 * 5 = 2.5, must round up to 3 dispensable units");

const halfTabOd7Days = calcDispenseQty({ frequency: "OD", dosageAmount: "0.5", duration: "7 days" });
assert.equal(halfTabOd7Days, 4, "OD with 0.5 tablets for 7 days: 0.5 * 1 * 7 = 3.5, must round up to 4 dispensable units");

const quarterTabQds = calcDispenseQty({ frequency: "QDS", dosageAmount: "0.25", duration: "4 days" });
assert.equal(quarterTabQds, 4, "QDS with 0.25 tablets for 4 days: 0.25 * 4 * 4 = 4 units");
console.log("✔ PASS: Fractional / half-tablet dosages calculate accurately and round up to whole units.\n");

// Test 6: Canonical Vocabulary Check
console.log("Test 6: Canonical Vocabulary Validation");
const expectedFrequencies = ["OD", "BD", "TDS", "QDS", "QID", "EOD", "STAT", "CUSTOM"];
for (const freq of expectedFrequencies) {
  assert.ok(VALID_FREQUENCIES.includes(freq as any), `Frequency ${freq} should be in VALID_FREQUENCIES`);
}

const expectedRoutes = ["ORAL", "SUPPOSITORY", "IM", "IV", "SC", "OTHER"];
for (const route of expectedRoutes) {
  assert.ok(VALID_ROUTES.includes(route as any), `Route ${route} should be in VALID_ROUTES`);
}
console.log("✔ PASS: All canonical frequency codes and administration routes defined.\n");

console.log("🎉 ALL PRESCRIPTION SAFETY & CALCULATION TESTS PASSED SUCCESSFULLY!");

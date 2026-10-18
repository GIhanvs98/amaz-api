import express from "express";
import { verifyToken } from "../middlewares/auth.middleware.js";
import {
  syncOrCreateDailySheet,
  getDailySheets,
  getDailySheetById,
  verifyDailySheet,
  approveDailySheet,
  markDailySheetPaid,
  getFundOfficeMetrics,
  getDoctorWiseReports,
  getDoctorEarningsSummary,
  disburseDoctorShare,
  getDoctorBankDetails,
  updateDoctorBankDetails,
  getFrontdeskDoctorShares,
  getUnifiedPaymentHistory
} from "../controllers/fund-office.controller.js";

const router = express.Router();

router.use(verifyToken);

// Fund Office Dashboard Metrics & Reports
router.get("/metrics", getFundOfficeMetrics);
router.get("/reports", getDoctorWiseReports);
router.get("/doctor-summary", getDoctorEarningsSummary);

// Front Desk & Shared Payment Ledger Endpoints
router.get("/frontdesk/doctor-shares", getFrontdeskDoctorShares);
router.get("/payment-history", getUnifiedPaymentHistory);

// Doctor Bank Details
router.get("/doctors/:id/bank-details", getDoctorBankDetails);
router.put("/doctors/:id/bank-details", updateDoctorBankDetails);

// Doctor Daily Sheets & Patient Records
router.post("/daily-sheets/sync-or-create", syncOrCreateDailySheet);
router.get("/daily-sheets", getDailySheets);
router.get("/daily-sheets/:id", getDailySheetById);

// Workflow Status Transitions & Disbursements
router.patch("/daily-sheets/:id/verify", verifyDailySheet);
router.patch("/daily-sheets/:id/approve", approveDailySheet);
router.patch("/daily-sheets/:id/pay", markDailySheetPaid);
router.post("/daily-sheets/:id/disburse", disburseDoctorShare);

export default router;


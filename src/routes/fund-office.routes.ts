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
  getDoctorWiseReports
} from "../controllers/fund-office.controller.js";

const router = express.Router();

router.use(verifyToken);

// Fund Office Dashboard Metrics & Reports
router.get("/metrics", getFundOfficeMetrics);
router.get("/reports", getDoctorWiseReports);

// Doctor Daily Sheets & Patient Records
router.post("/daily-sheets/sync-or-create", syncOrCreateDailySheet);
router.get("/daily-sheets", getDailySheets);
router.get("/daily-sheets/:id", getDailySheetById);

// Workflow Status Transitions
router.patch("/daily-sheets/:id/verify", verifyDailySheet);
router.patch("/daily-sheets/:id/approve", approveDailySheet);
router.patch("/daily-sheets/:id/pay", markDailySheetPaid);

export default router;

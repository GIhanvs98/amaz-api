import express from "express";
import {
  clockIn,
  clockOut,
  getAttendance,
  applyLeave,
  getLeaves,
  updateLeaveStatus,
  generatePayroll,
  getPayroll
} from "../controllers/hr.controller.js";

const router = express.Router();

// Attendance
router.post("/attendance/clock-in", clockIn);
router.post("/attendance/clock-out", clockOut);
router.get("/attendance", getAttendance);

// Leaves
router.post("/leaves", applyLeave);
router.get("/leaves", getLeaves);
router.patch("/leaves/:id/status", updateLeaveStatus);

// Payroll
router.post("/payroll/generate", generatePayroll);
router.get("/payroll", getPayroll);

export default router;

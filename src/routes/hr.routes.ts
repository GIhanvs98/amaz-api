import express from "express";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { getRoleTemplates, createRoleTemplate, updateRoleTemplate, deleteRoleTemplate } from "../controllers/payrollTemplate.controller.js";
import {
  clockIn,
  clockOut,
  getAttendance,
  applyLeave,
  getLeaves,
  updateLeaveStatus,
  generatePayroll,
  getPayroll,
  getPayrollProfile,
  updatePayrollProfile,
  getSalaryComponents,
  createSalaryComponent,
  assignEmployeeComponent,
  removeEmployeeComponent,
  getPayrollRunById,
  updatePayrollRunStatus,
  updatePayrollRecordStatus,
  getMyPayslips
} from "../controllers/hr.controller.js";
import {
  getOvertimeRecords,
  createOvertimeRecord,
  updateOvertimeStatus,
  getOvertimeRates
} from "../controllers/ot.controller.js";
import {
  getAllowanceRules,
  createAllowanceRule,
  updateAllowanceRule,
  deleteAllowanceRule
} from "../controllers/allowance.controller.js";

const router = express.Router();

// Attendance
router.post("/attendance/clock-in", clockIn);
router.post("/attendance/clock-out", clockOut);
router.get("/attendance", getAttendance);

// Leaves
router.post("/leaves", applyLeave);
router.get("/leaves", getLeaves);
router.patch("/leaves/:id/status", verifyToken, updateLeaveStatus);

// Overtime (OT)
router.get("/overtime", verifyToken, getOvertimeRecords);
router.post("/overtime", verifyToken, createOvertimeRecord);
router.patch("/overtime/:id/status", verifyToken, updateOvertimeStatus);
router.get("/overtime/rates", verifyToken, getOvertimeRates);

// Allowance & Component Rules
router.get("/allowance-rules", verifyToken, getAllowanceRules);
router.post("/allowance-rules", verifyToken, createAllowanceRule);
router.put("/allowance-rules/:id", verifyToken, updateAllowanceRule);
router.delete("/allowance-rules/:id", verifyToken, deleteAllowanceRule);

// Payroll
router.post("/payroll/generate", verifyToken, generatePayroll);
router.get("/payroll", verifyToken, getPayroll);
router.get("/payroll/:id", verifyToken, getPayrollRunById);
router.patch("/payroll/:id/status", verifyToken, updatePayrollRunStatus);
router.patch("/payroll/records/:recordId/status", verifyToken, updatePayrollRecordStatus);
router.get("/my-payslips", verifyToken, getMyPayslips);

// Employee Payroll Profiles & Components
router.get("/employees/:userId/payroll-profile", verifyToken, getPayrollProfile);
router.put("/employees/:userId/payroll-profile", verifyToken, updatePayrollProfile);
router.post("/employees/:userId/components", verifyToken, assignEmployeeComponent);
router.delete("/employees/:userId/components/:id", verifyToken, removeEmployeeComponent);
router.delete("/components/assignments/:id", verifyToken, removeEmployeeComponent);

// Global Salary Components
router.get("/components", verifyToken, getSalaryComponents);
router.post("/components", verifyToken, createSalaryComponent);

// Role Templates
router.get("/role-templates", verifyToken, getRoleTemplates);
router.post("/role-templates", verifyToken, createRoleTemplate);
router.put("/role-templates/:id", verifyToken, updateRoleTemplate);
router.delete("/role-templates/:id", verifyToken, deleteRoleTemplate);

export default router;

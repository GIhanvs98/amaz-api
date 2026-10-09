import express from "express";
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
  getPayrollRunById
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
router.get("/payroll/:id", getPayrollRunById);

// Employee Payroll Profiles & Components
router.get("/employees/:userId/payroll-profile", getPayrollProfile);
router.put("/employees/:userId/payroll-profile", updatePayrollProfile);
router.post("/employees/:userId/components", assignEmployeeComponent);
router.delete("/employees/:userId/components/:id", removeEmployeeComponent);

// Global Salary Components
router.get("/components", getSalaryComponents);
router.post("/components", createSalaryComponent);

// Role Templates
router.get("/role-templates", getRoleTemplates);
router.post("/role-templates", createRoleTemplate);
router.put("/role-templates/:id", updateRoleTemplate);
router.delete("/role-templates/:id", deleteRoleTemplate);

export default router;

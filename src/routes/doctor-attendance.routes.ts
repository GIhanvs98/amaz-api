import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { markDoctorArrived, getDoctorsTodayStatus, getDoctorMetrics } from "../controllers/doctor-attendance.controller.js";

const router = Router();

// GET /api/doctors/today - Status of today's scheduled and arrived doctors
router.get("/today", getDoctorsTodayStatus);

// POST /api/doctors/:id/attendance/arrive - Mark doctor arrived (Admin, Doctor, HR, Receptionist, Frontdesk)
router.post(
  "/:id/attendance/arrive",
  verifyToken,
  requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'HR', 'RECEPTIONIST', 'FRONTDESK']),
  markDoctorArrived
);

// GET /api/doctors/metrics
router.get(
  "/metrics",
  verifyToken,
  requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'HR']),
  getDoctorMetrics
);

export default router;

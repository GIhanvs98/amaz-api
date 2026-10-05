import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { markDoctorArrived, getDoctorsTodayStatus, getDoctorMetrics } from "../controllers/doctor-attendance.controller.js";

const router = Router();

router.use(verifyToken, requireRole(['ADMIN', 'DOCTOR', 'HR']));

// GET /api/doctors/metrics
router.get("/metrics", getDoctorMetrics);

// POST /api/doctors/:id/attendance/arrive
router.post("/:id/attendance/arrive", markDoctorArrived);

// GET /api/doctors/today
router.get("/today", getDoctorsTodayStatus);

export default router;

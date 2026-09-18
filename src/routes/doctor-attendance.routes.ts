import { Router } from "express";
import { markDoctorArrived } from "../controllers/doctor-attendance.controller.js";

const router = Router();

// POST /api/doctors/:id/attendance/arrive
router.post("/:id/attendance/arrive", markDoctorArrived);

export default router;

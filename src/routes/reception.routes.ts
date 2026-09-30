import { Router } from "express";
import { generateToken, getPatients, getMetrics, getPatientById, markDoctorArrived, markDoctorOut, updateShiftPeriod } from "../controllers/reception.controller.js";

const router = Router();

// GET /api/reception/patients
router.get("/patients", getPatients);

// GET /api/reception/metrics
router.get("/metrics", getMetrics);

// GET /api/reception/patients/:id
router.get("/patients/:id", getPatientById);

// POST /api/reception/token
router.post("/token", generateToken);

// POST /api/reception/doctors/:id/arrive
router.post("/doctors/:id/arrive", markDoctorArrived);

// POST /api/reception/doctors/:id/out
router.post("/doctors/:id/out", markDoctorOut);

// POST /api/reception/doctors/:id/shift
router.post("/doctors/:id/shift", updateShiftPeriod);

export default router;

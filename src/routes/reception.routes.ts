import { Router } from "express";
import { generateToken, getPatients, getMetrics, getPatientById, markDoctorArrived } from "../controllers/reception.controller.js";

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

export default router;

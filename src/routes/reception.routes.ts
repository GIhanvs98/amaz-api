import { Router } from "express";
import { generateToken, getPatients, getMetrics, updateDoctorRoom } from "../controllers/reception.controller.js";

const router = Router();

// GET /api/reception/patients
router.get("/patients", getPatients);

// GET /api/reception/metrics
router.get("/metrics", getMetrics);

// POST /api/reception/token
router.post("/token", generateToken);

// PATCH /api/reception/doctors/:id/room
router.patch("/doctors/:id/room", updateDoctorRoom);

export default router;

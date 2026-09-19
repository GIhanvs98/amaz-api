import { Router } from "express";
import { generateToken, getPatients, getMetrics } from "../controllers/reception.controller.js";

const router = Router();

// GET /api/reception/patients
router.get("/patients", getPatients);

// GET /api/reception/metrics
router.get("/metrics", getMetrics);

// POST /api/reception/token
router.post("/token", generateToken);

export default router;

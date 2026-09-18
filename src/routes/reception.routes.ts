import { Router } from "express";
import { getPatients, generateToken } from "../controllers/reception.controller.js";

const router = Router();

// POST /api/reception/token
router.post("/token", generateToken);

// GET /api/reception/patients
router.get("/patients", getPatients);

export default router;

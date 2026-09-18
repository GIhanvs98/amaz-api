import { Router } from "express";
import { createOrGetPatient, searchPatient } from "../controllers/patient.controller.js";

const router = Router();

router.post("/", createOrGetPatient);
router.get("/search", searchPatient);

export default router;

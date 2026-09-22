import { Router } from "express";
import { createOrGetPatient, searchPatient, getPatientById } from "../controllers/patient.controller.js";

const router = Router();

router.post("/", createOrGetPatient);
router.get("/search", searchPatient);
router.get("/:id", getPatientById);

export default router;

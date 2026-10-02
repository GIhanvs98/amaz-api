import { Router } from "express";
import { createOrGetPatient, searchPatient, getPatientById, updatePatient } from "../controllers/patient.controller.js";

const router = Router();

router.post("/", createOrGetPatient);
router.get("/search", searchPatient);
router.get("/:id", getPatientById);
router.post("/:id/update", updatePatient);

export default router;

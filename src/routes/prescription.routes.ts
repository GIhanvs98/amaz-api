import { Router } from "express";
import { createPrescription, getPendingPrescriptions, markPrescriptionDispensed, updatePrescriptionStatus, getPrescriptionHistory, deletePrescription, updatePrescription, getPrescriptionById } from "../controllers/prescription.controller.js";

const router = Router();

router.post("/", createPrescription);
router.get("/", getPrescriptionHistory);
router.get("/pending", getPendingPrescriptions);
router.patch("/:id/status", updatePrescriptionStatus);
router.post("/:id/dispense", markPrescriptionDispensed);
router.get("/:id", getPrescriptionById);

export default router;

router.delete("/:id", deletePrescription);

router.put("/:id", updatePrescription);

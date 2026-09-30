import { Router } from "express";
import { createPrescription, getPendingPrescriptions, markPrescriptionDispensed, updatePrescriptionStatus, getPrescriptionHistory, deletePrescription, updatePrescription } from "../controllers/prescription.controller.js";

const router = Router();

router.post("/", createPrescription);
router.get("/", getPrescriptionHistory);
router.get("/pending", getPendingPrescriptions);
router.patch("/:id/status", updatePrescriptionStatus);
router.post("/:id/dispense", markPrescriptionDispensed);

export default router;

router.delete("/:id", deletePrescription);

router.put("/:id", updatePrescription);

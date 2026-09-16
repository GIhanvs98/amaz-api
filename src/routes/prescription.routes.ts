import { Router } from "express";
import { createPrescription, getPendingPrescriptions, markPrescriptionDispensed } from "../controllers/prescription.controller.js";

const router = Router();

router.post("/", createPrescription);
router.get("/pending", getPendingPrescriptions);
router.post("/:id/dispense", markPrescriptionDispensed);

export default router;

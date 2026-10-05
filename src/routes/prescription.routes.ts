import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { createPrescription, getPendingPrescriptions, markPrescriptionDispensed, updatePrescriptionStatus, getPrescriptionHistory, deletePrescription, updatePrescription, getPrescriptionById } from "../controllers/prescription.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.use(verifyToken, requireRole(['ADMIN', 'DOCTOR', 'PHARMACIST', 'RECEPTIONIST']));

router.post("/", createPrescription);
router.get("/", cacheMiddleware(60), getPrescriptionHistory);
router.get("/pending", cacheMiddleware(60), getPendingPrescriptions);
router.patch("/:id/status", updatePrescriptionStatus);
router.post("/:id/dispense", markPrescriptionDispensed);
router.put("/:id", updatePrescription);
router.delete("/:id", deletePrescription);
router.get("/:id", cacheMiddleware(60), getPrescriptionById);

export default router;

import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { createPrescription, getPendingPrescriptions, markPrescriptionDispensed, updatePrescriptionStatus, getPrescriptionHistory, deletePrescription, updatePrescription, getPrescriptionById, addItemToPrescription, updatePrescriptionItem, deletePrescriptionItem } from "../controllers/prescription.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.use(verifyToken, requireRole(['ADMIN', 'DOCTOR', 'PHARMACIST', 'RECEPTIONIST']));

router.post("/", createPrescription);
router.get("/", getPrescriptionHistory);
router.get("/pending", getPendingPrescriptions);
router.patch("/:id/status", updatePrescriptionStatus);
router.post("/:id/dispense", markPrescriptionDispensed);
router.put("/:id", updatePrescription);
router.delete("/:id", deletePrescription);
router.get("/:id", getPrescriptionById);

// Granular medicine item routes
router.post("/:id/items", addItemToPrescription);
router.put("/:id/items/:itemId", updatePrescriptionItem);
router.delete("/:id/items/:itemId", deletePrescriptionItem);

export default router;

import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { createOrGetPatient, searchPatient, getPatientById, updatePatient, getAllPatients, deletePatient } from "../controllers/patient.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.use(verifyToken, requireRole(['ALL']));

router.get("/", getAllPatients);
router.post("/", createOrGetPatient);
router.get("/search", searchPatient);
router.get("/:id", cacheMiddleware(60), getPatientById);
router.post("/:id/update", updatePatient);
router.delete("/:id", deletePatient);

export default router;

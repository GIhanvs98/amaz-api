import { Router } from "express";
import { createOrGetPatient, searchPatient, getPatientById, updatePatient } from "../controllers/patient.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.post("/", createOrGetPatient);
router.get("/search", searchPatient);
router.get("/:id", cacheMiddleware(60), getPatientById);
router.post("/:id/update", updatePatient);

export default router;

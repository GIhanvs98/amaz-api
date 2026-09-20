import { Router } from "express";
import { generateToken, getDoctorQueue, updateTokenStatus, getPendingPrescriptions } from "../controllers/token.controller.js";

const router = Router();

router.post("/", generateToken);
router.get("/queue", getDoctorQueue);
router.get("/prescriptions", getPendingPrescriptions);
router.patch("/status", updateTokenStatus);

export default router;

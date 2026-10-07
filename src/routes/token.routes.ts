import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { generateToken, getDoctorQueue, updateTokenStatus, getPendingPrescriptions } from "../controllers/token.controller.js";

const router = Router();

router.use(verifyToken, requireRole(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST', 'CASHIER', 'DOCTOR', 'NURSE']));

router.post("/", generateToken);
router.get("/queue", getDoctorQueue);
router.get("/prescriptions", getPendingPrescriptions);
router.patch("/status", updateTokenStatus);

export default router;

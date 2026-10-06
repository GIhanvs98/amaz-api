import { Router } from "express";
import { requestOTP, verifyOTP, getPatientHistory } from "../controllers/patient-portal.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";

const router = Router();

router.post("/request-otp", requestOTP);
router.post("/verify-otp", verifyOTP);
// Uses patient JWT from verify-otp
router.get("/history", verifyToken, getPatientHistory);

export default router;

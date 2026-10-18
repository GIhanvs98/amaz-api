import { Router } from "express";
import { requestOTP, verifyOTP, getPatientHistory } from "../controllers/patient-portal.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";

import rateLimit from "express-rate-limit";

const isLocalhost = (req: any) => {
  const ip = req.ip || req.socket.remoteAddress || "";
  const host = req.hostname || req.headers.host || "";
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    host.includes("localhost") ||
    host.includes("127.0.0.1")
  );
};

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 OTP requests per window
  skip: (req) => isLocalhost(req),
  message: { error: "Too many OTP requests, please try again later." }
});

const router = Router();

router.post("/request-otp", otpLimiter, requestOTP);
router.post("/verify-otp", otpLimiter, verifyOTP);
// Uses patient JWT from verify-otp
router.get("/history", verifyToken, getPatientHistory);

export default router;

import { Router } from "express";
import { login, refresh, logout, forgotPassword, resetPassword } from "../controllers/auth.controller.js";
import rateLimit from "express-rate-limit";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: { error: "Too many attempts, please try again later." }
});

const router = Router();

router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);
router.post("/login", authLimiter, login);
router.get("/refresh", refresh);
router.post("/logout", logout);

export default router;

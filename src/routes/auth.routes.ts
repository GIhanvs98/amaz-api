import { Router } from "express";
import { login, refresh, logout, forgotPassword, resetPassword } from "../controllers/auth.controller.js";
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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  skip: (req) => isLocalhost(req),
  message: { error: "Too many attempts, please try again later." }
});

const router = Router();

router.post("/forgot-password", authLimiter, forgotPassword);
router.post("/reset-password", authLimiter, resetPassword);
router.post("/login", authLimiter, login);
router.get("/refresh", refresh);
router.post("/logout", logout);

export default router;

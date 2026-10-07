import { Router } from "express";
import { getUsersByRole, getProfile, updateProfile, updatePassword } from "../controllers/user.controller.js";
import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.use(verifyToken, requireRole(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE', 'PHARMACIST', 'LABTECH', 'CASHIER']));

router.get("/me", cacheMiddleware(60, true), getProfile);
router.put("/me", updateProfile);
router.put("/me/password", updatePassword);

router.get("/", cacheMiddleware(300), getUsersByRole);

export default router;

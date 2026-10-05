import { Router } from "express";
import { getSettings, updateSettings } from "../controllers/setting.controller.js";
import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

// Allow authenticated users to fetch settings
router.get("/", verifyToken, cacheMiddleware(3600), getSettings);

// Only Superadmin can update settings
router.put("/", verifyToken, requireRole(['SUPERADMIN']), updateSettings);

export default router;

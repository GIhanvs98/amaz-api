import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { getDashboardStats } from "../controllers/dashboard.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.use(verifyToken, requireRole(['ADMIN', 'MANAGER', 'SUPERADMIN']));

router.get("/", cacheMiddleware(300), getDashboardStats);

export default router;

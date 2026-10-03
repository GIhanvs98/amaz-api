import { Router } from "express";
import { getUsersByRole, getProfile, updateProfile, updatePassword } from "../controllers/user.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.get("/me", verifyToken, cacheMiddleware(60, true), getProfile);
router.put("/me", verifyToken, updateProfile);
router.put("/me/password", verifyToken, updatePassword);

router.get("/", cacheMiddleware(300), getUsersByRole);

export default router;

import { Router } from "express";
import { getUsersByRole, getProfile, updateProfile, updatePassword } from "../controllers/user.controller.js";
import { verifyToken } from "../middlewares/auth.middleware.js";

const router = Router();

router.get("/me", verifyToken, getProfile);
router.put("/me", verifyToken, updateProfile);
router.put("/me/password", verifyToken, updatePassword);

router.get("/", getUsersByRole);

export default router;

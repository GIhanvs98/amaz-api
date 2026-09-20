import { Router } from "express";
import { getUsersByRole } from "../controllers/user.controller.js";

const router = Router();

router.get("/", getUsersByRole);

export default router;

import { Router } from "express";
import { getAdminMetrics } from "../controllers/admin.controller.js";

const router = Router();

router.get("/metrics", getAdminMetrics);

export default router;

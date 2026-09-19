import { Router } from "express";
import { getAdminMetrics, getStaff, createStaff, updateStaff, deleteStaff } from "../controllers/admin.controller.js";

const router = Router();

router.get("/metrics", getAdminMetrics);

router.get("/staff", getStaff);
router.post("/staff", createStaff);
router.put("/staff/:id", updateStaff);
router.delete("/staff/:id", deleteStaff);

export default router;

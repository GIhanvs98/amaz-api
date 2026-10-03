import { Router } from "express";
import { getAdminMetrics, getStaff, createStaff, updateStaff, deleteStaff, getRoles, createRole, updateRolePermissions } from "../controllers/admin.controller.js";
import departmentRoutes from "./department.routes.js";

const router = Router();

router.get("/metrics", getAdminMetrics);

router.get("/staff", getStaff);
router.post("/staff", createStaff);
router.put("/staff/:id", updateStaff);
router.delete("/staff/:id", deleteStaff);

router.get("/roles", getRoles);
router.post("/roles", createRole);
router.put("/roles/:id/permissions", updateRolePermissions);

// Departments
router.use("/departments", departmentRoutes);

export default router;

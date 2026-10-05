import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { getAdminMetrics, getStaff, createStaff, updateStaff, deleteStaff, getRoles, createRole, updateRolePermissions } from "../controllers/admin.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";
import departmentRoutes from "./department.routes.js";

const router = Router();

router.use(verifyToken, requireRole(['ADMIN']));

router.get("/metrics", cacheMiddleware(300), getAdminMetrics);

router.get("/staff", cacheMiddleware(300), getStaff);
router.post("/staff", createStaff);
router.put("/staff/:id", updateStaff);
router.delete("/staff/:id", deleteStaff);

router.get("/roles", cacheMiddleware(3600), getRoles);
router.post("/roles", createRole);
router.put("/roles/:id/permissions", updateRolePermissions);

// Departments
router.use("/departments", departmentRoutes);

export default router;

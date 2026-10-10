import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { getAdminMetrics, getStaff, createStaff, updateStaff, deleteStaff, getRoles, createRole, updateRolePermissions, getRooms, getRoomSchedules } from "../controllers/admin.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";
import departmentRoutes from "./department.routes.js";

const router = Router();

router.use(verifyToken, requireRole(['ADMIN', 'SUPERADMIN']));

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
// Rooms
router.get("/rooms", cacheMiddleware(300), getRooms);
router.get("/rooms/:id/schedules", getRoomSchedules);

export default router;

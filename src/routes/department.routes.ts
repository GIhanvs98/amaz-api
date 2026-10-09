import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { departmentController } from "../controllers/department.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.use(verifyToken, requireRole(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE', 'PHARMACIST', 'LABTECH', 'CASHIER']));

// Department CRUD
router.get("/doctors", departmentController.getAvailableDoctors.bind(departmentController));
router.get("/", cacheMiddleware(3600), departmentController.getDepartments.bind(departmentController));
router.post("/", departmentController.createDepartment.bind(departmentController));
router.put("/:id", departmentController.updateDepartment.bind(departmentController));
router.delete("/:id", departmentController.deleteDepartment.bind(departmentController));

// Doctor Assignment & Fees
router.put("/doctor/:doctorId", departmentController.updateDoctorAssignment.bind(departmentController));

export default router;

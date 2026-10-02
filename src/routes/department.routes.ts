import { Router } from "express";
import { departmentController } from "../controllers/department.controller.js";

const router = Router();

// Department CRUD
router.get("/doctors", departmentController.getAvailableDoctors.bind(departmentController));
router.get("/", departmentController.getDepartments.bind(departmentController));
router.post("/", departmentController.createDepartment.bind(departmentController));
router.put("/:id", departmentController.updateDepartment.bind(departmentController));
router.delete("/:id", departmentController.deleteDepartment.bind(departmentController));

// Doctor Assignment & Fees
router.put("/doctor/:doctorId", departmentController.updateDoctorAssignment.bind(departmentController));

export default router;

import { verifyToken, requireRole, requireRoleOrPermission } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import multer from "multer";
import { extraServiceController } from "../controllers/extraService.controller.js";
import { extraServiceOrderController } from "../controllers/extraServiceOrder.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

// Multer memory storage allows direct upload to S3 or disk fallback for any file type (30MB max)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }
});

const router = Router();

router.use(verifyToken);

// ==========================================
// Workstation Procedure Station Routes
// ==========================================
router.get("/queue", requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE', 'EXTRA SERVICES'], 'READ', 'Extra Services'), extraServiceController.getQueue.bind(extraServiceController));
router.post("/upload", requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE', 'EXTRA SERVICES'], 'CREATE', 'Extra Services'), upload.single("file"), extraServiceController.uploadReport.bind(extraServiceController));
router.patch("/appointments/:id/status", requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE', 'EXTRA SERVICES'], 'UPDATE', 'Extra Services'), extraServiceController.updateStatus.bind(extraServiceController));

// ==========================================
// Catalog Routes
// ==========================================
router.get("/", cacheMiddleware(3600), extraServiceController.getServices.bind(extraServiceController));
router.post("/", requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST', 'EXTRA SERVICES'], 'CREATE', 'Extra Services Config'), extraServiceController.createService.bind(extraServiceController));
router.put("/:id", requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST', 'EXTRA SERVICES'], 'UPDATE', 'Extra Services Config'), extraServiceController.updateService.bind(extraServiceController));
router.delete("/:id", requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST', 'EXTRA SERVICES'], 'DELETE', 'Extra Services Config'), extraServiceController.deleteService.bind(extraServiceController));

// ==========================================
// Order Lifecycle & File Upload Routes
// ==========================================
router.post("/orders", requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'EXTRA SERVICES'], 'CREATE', 'Extra Services'), extraServiceOrderController.createOrders);
router.get("/orders", requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'LABTECH', 'NURSE', 'EXTRA SERVICES'], 'READ', 'Extra Services'), extraServiceOrderController.getOrders);
router.get("/orders/:id", requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'LABTECH', 'NURSE', 'EXTRA SERVICES'], 'READ', 'Extra Services'), extraServiceOrderController.getOrderById);
router.patch("/orders/:id/status", requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'LABTECH', 'NURSE', 'EXTRA SERVICES'], 'UPDATE', 'Extra Services'), extraServiceOrderController.updateOrderStatus);
router.post("/orders/:id/upload", requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'LABTECH', 'NURSE', 'EXTRA SERVICES'], 'CREATE', 'Extra Services'), upload.single("file"), extraServiceOrderController.uploadReportFile);
router.delete("/orders/:id/files/:fileId", requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'EXTRA SERVICES'], 'DELETE', 'Extra Services'), extraServiceOrderController.deleteReportFile);

export default router;

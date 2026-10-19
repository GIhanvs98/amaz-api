import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
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
router.get("/queue", requireRole(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE']), extraServiceController.getQueue.bind(extraServiceController));
router.post("/upload", requireRole(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE']), upload.single("file"), extraServiceController.uploadReport.bind(extraServiceController));
router.patch("/appointments/:id/status", requireRole(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE']), extraServiceController.updateStatus.bind(extraServiceController));

// ==========================================
// Catalog Routes
// ==========================================
router.get("/", cacheMiddleware(3600), extraServiceController.getServices.bind(extraServiceController));
router.post("/", requireRole(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST']), extraServiceController.createService.bind(extraServiceController));
router.put("/:id", requireRole(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST']), extraServiceController.updateService.bind(extraServiceController));
router.delete("/:id", requireRole(['ADMIN', 'SUPERADMIN', 'RECEPTIONIST']), extraServiceController.deleteService.bind(extraServiceController));

// ==========================================
// Order Lifecycle & File Upload Routes
// ==========================================
router.post("/orders", requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE']), extraServiceOrderController.createOrders);
router.get("/orders", requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'LABTECH', 'NURSE']), extraServiceOrderController.getOrders);
router.get("/orders/:id", requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'LABTECH', 'NURSE']), extraServiceOrderController.getOrderById);
router.patch("/orders/:id/status", requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'LABTECH', 'NURSE']), extraServiceOrderController.updateOrderStatus);
router.post("/orders/:id/upload", requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'LABTECH', 'NURSE']), upload.single("file"), extraServiceOrderController.uploadReportFile);
router.delete("/orders/:id/files/:fileId", requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST']), extraServiceOrderController.deleteReportFile);

export default router;

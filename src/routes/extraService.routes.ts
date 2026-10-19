import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { extraServiceController } from "../controllers/extraService.controller.js";
import { extraServiceOrderController } from "../controllers/extraServiceOrder.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";
import multer from "multer";

// Multer memory storage allows direct upload to S3 or disk fallback for any file type
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB max
});

const router = Router();

router.use(verifyToken);

// ==========================================
// Catalog Routes
// ==========================================
router.get("/", cacheMiddleware(3600), extraServiceController.getServices.bind(extraServiceController));
router.post("/", requireRole(['ADMIN', 'SUPERADMIN']), extraServiceController.createService.bind(extraServiceController));
router.put("/:id", requireRole(['ADMIN', 'SUPERADMIN']), extraServiceController.updateService.bind(extraServiceController));
router.delete("/:id", requireRole(['ADMIN', 'SUPERADMIN']), extraServiceController.deleteService.bind(extraServiceController));

// ==========================================
// Order Lifecycle & File Upload Routes
// ==========================================
// Create order(s) - accessible by Doctors, Receptionists, and Admins
router.post("/orders", requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'NURSE']), extraServiceOrderController.createOrders);

// List orders with status & search filters
router.get("/orders", requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'LABTECH', 'NURSE']), extraServiceOrderController.getOrders);

// Single order details
router.get("/orders/:id", requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'LABTECH', 'NURSE']), extraServiceOrderController.getOrderById);

// Update order status (PENDING -> IN_PROGRESS -> COMPLETED / CANCELLED)
router.patch("/orders/:id/status", requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'LABTECH', 'NURSE']), extraServiceOrderController.updateOrderStatus);

// Upload report file (ANY file type: PDF, images, DOCX, DICOM, etc.)
router.post("/orders/:id/upload", requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST', 'LABTECH', 'NURSE']), upload.single("file"), extraServiceOrderController.uploadReportFile);

// Delete an attached report file
router.delete("/orders/:id/files/:fileId", requireRole(['ADMIN', 'SUPERADMIN', 'DOCTOR', 'RECEPTIONIST']), extraServiceOrderController.deleteReportFile);

export default router;

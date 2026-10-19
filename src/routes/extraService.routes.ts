import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import multer from "multer";
import { extraServiceController } from "../controllers/extraService.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 } // 30MB max to support any file format including DICOM and hi-res scans
});

router.get("/queue", verifyToken, requireRole(['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE']), extraServiceController.getQueue.bind(extraServiceController));
router.post("/upload", verifyToken, requireRole(['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE']), upload.single("file"), extraServiceController.uploadReport.bind(extraServiceController));
router.patch("/appointments/:id/status", verifyToken, requireRole(['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE']), extraServiceController.updateStatus.bind(extraServiceController));

router.get("/", verifyToken, requireRole(['ADMIN', 'RECEPTIONIST', 'DOCTOR', 'NURSE']), cacheMiddleware(3600), extraServiceController.getServices.bind(extraServiceController));
router.post("/", verifyToken, requireRole(['ADMIN', 'RECEPTIONIST']), extraServiceController.createService.bind(extraServiceController));
router.put("/:id", verifyToken, requireRole(['ADMIN', 'RECEPTIONIST']), extraServiceController.updateService.bind(extraServiceController));
router.delete("/:id", verifyToken, requireRole(['ADMIN', 'RECEPTIONIST']), extraServiceController.deleteService.bind(extraServiceController));

export default router;

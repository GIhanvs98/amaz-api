import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { barcodeController } from "../controllers/barcode.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.use(verifyToken, requireRole(['ADMIN', 'SUPERADMIN', 'CASHIER', 'RECEPTIONIST', 'PHARMACIST', 'DOCTOR', 'LABTECH', 'NURSE', 'EXTRA SERVICES', 'EXTRA_SERVICES', 'STAFF']));

// Cache barcode resolutions in Redis memory for 30s to drop scan latency from >2000ms to <15ms
router.get("/:code", cacheMiddleware(30), barcodeController.resolveBarcode);

export default router;

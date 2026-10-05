import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from "express";
import { barcodeController } from "../controllers/barcode.controller.js";

const router = Router();

router.use(verifyToken, requireRole(['ALL']));

router.get("/:code", barcodeController.resolveBarcode);

export default router;

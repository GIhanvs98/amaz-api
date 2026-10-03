import { Router } from "express";
import { barcodeController } from "../controllers/barcode.controller.js";

const router = Router();

router.get("/:code", barcodeController.resolveBarcode);

export default router;

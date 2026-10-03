import { Router } from 'express';
import { pharmacyController } from "../controllers/pharmacy.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.get('/metrics', cacheMiddleware(300), pharmacyController.getMetrics);
router.get('/medicines', cacheMiddleware(3600), pharmacyController.getMedicines);
router.post('/medicines', pharmacyController.addMedicine);

router.post('/stock', pharmacyController.addStockBatch);
router.post('/dispense', pharmacyController.dispense);

router.get('/alerts', pharmacyController.getAlerts);

router.post('/sell', pharmacyController.sell.bind(pharmacyController));

export default router;

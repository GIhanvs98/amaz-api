import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from 'express';
import { pharmacyController } from "../controllers/pharmacy.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.use(verifyToken, requireRole(['SUPERADMIN', 'ADMIN', 'PHARMACIST', 'DOCTOR']));

router.get('/metrics', cacheMiddleware(300), pharmacyController.getMetrics);
router.get('/medicines', cacheMiddleware(3600), pharmacyController.getMedicines);
router.post('/medicines', pharmacyController.addMedicine);
router.patch('/medicines/:id', pharmacyController.updateMedicine.bind(pharmacyController));
router.delete('/medicines/:id', pharmacyController.deleteMedicine.bind(pharmacyController));

router.post('/stock', pharmacyController.addStockBatch);
router.post('/dispense', pharmacyController.dispense);

router.get('/alerts', pharmacyController.getAlerts);

router.post('/sell', pharmacyController.sell.bind(pharmacyController));

export default router;

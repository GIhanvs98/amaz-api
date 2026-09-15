import { Router } from 'express';
import { pharmacyController } from '../controllers/pharmacy.controller';

const router = Router();

router.get('/medicines', pharmacyController.getMedicines);
router.post('/medicines', pharmacyController.addMedicine);

router.post('/stock', pharmacyController.addStockBatch);
router.post('/dispense', pharmacyController.dispense);

router.get('/alerts', pharmacyController.getAlerts);

export default router;

import { Router } from 'express';
import { financeController } from "../controllers/finance.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.get('/dashboard', cacheMiddleware(300), financeController.getDashboardData.bind(financeController));
router.get('/settlements', financeController.getSettlements.bind(financeController));

router.post('/expenses', financeController.addExpense.bind(financeController));
router.get('/expenses', financeController.getExpenses.bind(financeController));

router.post('/purchase-orders', financeController.createPurchaseOrder.bind(financeController));
router.get('/purchase-orders', financeController.getPurchaseOrders.bind(financeController));
router.patch('/purchase-orders/:id/status', financeController.updatePurchaseOrderStatus.bind(financeController));

export default router;

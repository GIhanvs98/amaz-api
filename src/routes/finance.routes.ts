import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { Router } from 'express';
import { financeController } from "../controllers/finance.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

router.use(verifyToken, requireRole(['SUPERADMIN', 'ADMIN', 'FINANCE', 'MANAGER']));

router.get('/dashboard', cacheMiddleware(300), financeController.getDashboardData.bind(financeController));
router.get('/settlements', financeController.getSettlements.bind(financeController));
router.get('/shifts', financeController.getShifts.bind(financeController));

router.post('/expenses', financeController.addExpense.bind(financeController));
router.get('/expenses', financeController.getExpenses.bind(financeController));
router.patch('/expenses/:id', financeController.updateExpense.bind(financeController));
router.delete('/expenses/:id', financeController.deleteExpense.bind(financeController));

router.get('/transactions', financeController.getTransactions.bind(financeController));

router.post('/purchase-orders', financeController.createPurchaseOrder.bind(financeController));
router.get('/purchase-orders', financeController.getPurchaseOrders.bind(financeController));
router.patch('/purchase-orders/:id/status', financeController.updatePurchaseOrderStatus.bind(financeController));

router.post('/suppliers', financeController.createSupplier.bind(financeController));
router.get('/suppliers', financeController.getSuppliers.bind(financeController));
router.patch('/suppliers/:id', financeController.updateSupplier.bind(financeController));
router.delete('/suppliers/:id', financeController.deleteSupplier.bind(financeController));

export default router;

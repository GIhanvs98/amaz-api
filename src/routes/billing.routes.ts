import { Router } from 'express';
import { billingController } from "../controllers/billing.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";

const router = Router();

// GET /api/billing/cashier-metrics
router.get('/cashier-metrics', cacheMiddleware(300), billingController.getCashierMetrics.bind(billingController));

// GET /api/billing/invoices?visitId=...
router.get('/invoices', billingController.getInvoice.bind(billingController));

// POST /api/billing/charge
router.post('/charge', billingController.charge.bind(billingController));

// POST /api/billing/invoices/:invoiceId/pay
router.post('/invoices/:invoiceId/pay', billingController.payInvoice.bind(billingController));

// DELETE /api/billing/invoices/:invoiceId/items/:lineItemId
router.delete('/invoices/:invoiceId/items/:lineItemId', billingController.removeCharge.bind(billingController));

// DELETE /api/billing/invoices/:invoiceId
router.delete('/invoices/:invoiceId', billingController.deleteInvoice.bind(billingController));

export default router;

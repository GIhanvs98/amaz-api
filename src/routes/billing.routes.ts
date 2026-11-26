import { verifyToken, requireRole, requireRoleOrPermission } from "../middlewares/auth.middleware.js";
import { Router } from 'express';
import { billingController } from "../controllers/billing.controller.js";
import { cacheMiddleware } from "../middlewares/cache.middleware.js";
import { financialTransactionLimiter } from "../middlewares/rate-limit.middleware.js";

const router = Router();

router.use(verifyToken);

// GET /api/billing/cashier-metrics
router.get('/cashier-metrics', requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'CASHIER', 'RECEPTIONIST'], 'READ', 'Billing'), cacheMiddleware(30), billingController.getCashierMetrics.bind(billingController));

// GET /api/billing/invoices?visitId=...
router.get('/invoices', requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'CASHIER', 'RECEPTIONIST'], 'READ', 'Billing'), billingController.getInvoice.bind(billingController));

// GET /api/billing/invoices/lookup?q=...
router.get('/invoices/lookup', requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'CASHIER', 'RECEPTIONIST'], 'READ', 'Billing'), billingController.lookupInvoice.bind(billingController));

// GET /api/billing/invoices/:identifier
router.get('/invoices/:identifier', requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'CASHIER', 'RECEPTIONIST'], 'READ', 'Billing'), billingController.getInvoiceByIdentifier.bind(billingController));

// POST /api/billing/charge
router.post('/charge', financialTransactionLimiter, requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'CASHIER', 'RECEPTIONIST'], 'CREATE', 'Billing'), billingController.charge.bind(billingController));

// POST /api/billing/invoices/:invoiceId/pay
router.post('/invoices/:invoiceId/pay', financialTransactionLimiter, requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'CASHIER', 'RECEPTIONIST'], 'UPDATE', 'Billing'), billingController.payInvoice.bind(billingController));

// POST /api/billing/refunds
router.post('/refunds', financialTransactionLimiter, requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'CASHIER', 'RECEPTIONIST'], 'CREATE', 'Refunds'), billingController.processRefund.bind(billingController));

// GET /api/billing/refunds
router.get('/refunds', requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'CASHIER', 'RECEPTIONIST'], 'READ', 'Refunds'), billingController.getRefunds.bind(billingController));

// DELETE /api/billing/invoices/:invoiceId/items/:lineItemId
router.delete('/invoices/:invoiceId/items/:lineItemId', requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'CASHIER', 'RECEPTIONIST', 'PHARMACIST'], 'DELETE', 'Billing'), billingController.removeCharge.bind(billingController));

// DELETE /api/billing/invoices/:invoiceId
router.delete('/invoices/:invoiceId', requireRoleOrPermission(['ADMIN', 'SUPERADMIN', 'CASHIER', 'RECEPTIONIST', 'PHARMACIST'], 'DELETE', 'Billing'), billingController.deleteInvoice.bind(billingController));

export default router;

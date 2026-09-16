import { Router } from 'express';
import { billingController } from '../controllers/billing.controller';

const router = Router();

// GET /api/billing/invoices?visitId=...
router.get('/invoices', billingController.getInvoice.bind(billingController));

// POST /api/billing/charge
router.post('/charge', billingController.charge.bind(billingController));

// POST /api/billing/invoices/:invoiceId/pay
router.post('/invoices/:invoiceId/pay', billingController.payInvoice.bind(billingController));

export default router;

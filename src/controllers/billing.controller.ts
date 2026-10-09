import { Request, Response } from 'express';
import { billingService } from "../services/billing.service.js";
import { clearCache } from "../middlewares/cache.middleware.js";
import { prisma } from "../lib/prisma.js";


export class BillingController {
  async charge(req: Request, res: Response) {
    try {
      const { visitId, patientId, department, referenceId, description, quantity, unitPrice } = req.body;
      
      if (!department || !description || quantity === undefined || unitPrice === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const qty = Number(quantity);
      const price = Number(unitPrice);

      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Quantity must be greater than 0' });
      }

      if (isNaN(price) || price < 0) {
        return res.status(400).json({ error: 'Unit price cannot be negative' });
      }

      const invoice = await billingService.addCharge({
        visitId,
        patientId,
        department,
        referenceId,
        description,
        quantity: qty,
        unitPrice: price
      });

      await clearCache("/api/finance/dashboard");
      await clearCache("/api/admin/metrics");

      res.status(201).json(invoice);
    } catch (error: any) {
      console.error('Add Charge Error:', error);
      res.status(500).json({ error: error.message || 'Failed to add charge' });
    }
  }

  async getInvoice(req: Request, res: Response) {
    try {
      const { invoiceId, visitId } = req.query;
      
      if (!invoiceId && !visitId) {
        // If no specific ID is provided, return all invoices
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 50;
        const invoices = await billingService.getAllInvoices(page, limit);
        return res.json(invoices);
      }

      const invoice = await billingService.getInvoice({ 
        invoiceId: invoiceId as string, 
        visitId: visitId as string 
      });

      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      res.json(invoice);
    } catch (error: any) {
      console.error('Get Invoice Error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch invoice' });
    }
  }

  async payInvoice(req: Request, res: Response) {
    try {
      const { invoiceId } = req.params;
      const { amount, method } = req.body;

      if (!amount || !method) {
        return res.status(400).json({ error: 'Missing payment amount or method' });
      }

      const user = (req as any).user;
      let shiftId: string | undefined = undefined;
      if (user) {
        const shift = await prisma.cashRegisterShift.findFirst({
          where: { openedBy: user.id, status: "OPEN" }
        });
        shiftId = shift?.id;
      }
      
      const updatedInvoice = await billingService.payInvoice(invoiceId as string, Number(amount), method as string, shiftId);
      
      await clearCache("/api/finance/dashboard");
      await clearCache("/api/admin/metrics");
      
      res.json(updatedInvoice);
    } catch (error: any) {
      console.error('Pay Invoice Error:', error);
      res.status(500).json({ error: error.message || 'Failed to pay invoice' });
    }
  }
  async getCashierMetrics(req: Request, res: Response) {
    try {
      const data = await billingService.getCashierMetrics();
      res.json(data);
    } catch (error: any) {
      console.error('Get Cashier Metrics Error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch metrics' });
    }
  }

  async removeCharge(req: Request, res: Response) {
    try {
      const { invoiceId, lineItemId } = req.params;
      const updatedInvoice = await billingService.removeCharge(invoiceId as string, lineItemId as string);
      res.json(updatedInvoice);
    } catch (error: any) {
      console.error('Remove Charge Error:', error);
      const status = error.message?.includes('DRAFT') ? 400 : 500;
      res.status(status).json({ error: error.message || 'Failed to remove charge' });
    }
  }

  async deleteInvoice(req: Request, res: Response) {
    try {
      const { invoiceId } = req.params;
      await billingService.deleteDraftInvoice(invoiceId as string);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Delete Invoice Error:', error);
      const status = error.message?.includes('DRAFT') ? 400 : 500;
      res.status(status).json({ error: error.message || 'Failed to delete invoice' });
    }
  }
}

export const billingController = new BillingController();

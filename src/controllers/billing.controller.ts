import { Request, Response } from 'express';
import { billingService } from '../services/billing.service';

export class BillingController {
  async charge(req: Request, res: Response) {
    try {
      const { visitId, patientId, department, referenceId, description, quantity, unitPrice } = req.body;
      
      if (!department || !description || quantity === undefined || unitPrice === undefined) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const invoice = await billingService.addCharge({
        visitId,
        patientId,
        department,
        referenceId,
        description,
        quantity: Number(quantity),
        unitPrice: Number(unitPrice)
      });

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
        const invoices = await billingService.getAllInvoices();
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

      const updatedInvoice = await billingService.payInvoice(invoiceId as string, Number(amount), method as string);
      res.json(updatedInvoice);
    } catch (error: any) {
      console.error('Pay Invoice Error:', error);
      res.status(500).json({ error: error.message || 'Failed to pay invoice' });
    }
  }
}

export const billingController = new BillingController();

import { prisma, withRetry } from '../lib/prisma.js';

export class BillingService {
  /**
   * Adds a charge to an existing DRAFT invoice, or creates a new one if it doesn't exist.
   */
  async addCharge(data: {
    invoiceId?: string;
    visitId?: string;
    patientId?: string;
    department: string;
    referenceId?: string;
    description: string;
    quantity: number;
    unitPrice: number;
  }) {
    return withRetry(async () => {
      const total = data.quantity * data.unitPrice;

      // 1. Try to find an open DRAFT invoice for this visit (or patient if walk-in)
      let invoice = null;
      
      if (data.invoiceId) {
        invoice = await prisma.invoice.findUnique({ where: { id: data.invoiceId } });
      } else if (data.visitId) {
        invoice = await prisma.invoice.findFirst({
          where: { visitId: data.visitId, status: "DRAFT" }
        });
      } else if (data.patientId) {
         invoice = await prisma.invoice.findFirst({
          where: { patientId: data.patientId, status: "DRAFT" }
        });
      }

      // 2. If no open invoice, create one
      if (!invoice) {
        invoice = await prisma.invoice.create({
          data: {
            visitId: data.visitId,
            patientId: data.patientId,
            status: "DRAFT",
            subtotal: 0,
            totalAmount: 0
          }
        });
      }

      // 3. Add the line item
      await prisma.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          department: data.department,
          referenceId: data.referenceId,
          description: data.description,
          quantity: data.quantity,
          unitPrice: data.unitPrice,
          total: total
        }
      });

      // 4. Update invoice totals
      const updatedInvoice = await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          subtotal: { increment: total },
          totalAmount: { increment: total }
        },
        include: {
          lineItems: true
        }
      });

      return updatedInvoice;
    });
  }

  /**
   * Fetch an invoice by visit ID or Invoice ID
   */
  async getInvoice(query: { invoiceId?: string, visitId?: string }) {
    return withRetry(async () => {
      if (query.invoiceId) {
        return prisma.invoice.findUnique({
          where: { id: query.invoiceId },
          include: { lineItems: true, payments: true }
        });
      } else if (query.visitId) {
        return prisma.invoice.findFirst({
          where: { visitId: query.visitId, status: "DRAFT" },
          include: { lineItems: true, payments: true }
        });
      }
      throw new Error("Must provide invoiceId or visitId");
    });
  }

  /**
   * Pay an invoice
   */
  async payInvoice(invoiceId: string, amount: number, method: string) {
    return withRetry(async () => {
      const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new Error("Invoice not found");
      if (invoice.status === "PAID") throw new Error("Invoice is already paid");
      
      // In a real system, you'd validate partial payments. Here we assume full payment.
      await prisma.payment.create({
        data: {
          invoiceId,
          amount,
          method,
          status: "COMPLETED"
        }
      });

      return prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: "PAID" },
        include: { lineItems: true, payments: true }
      });
    });
  }

  /**
   * Retrieves all invoices for the cashier dashboard list
   */
  async getAllInvoices() {
    return withRetry(() => prisma.invoice.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        lineItems: true,
        payments: true,
        Patient: true
      }
    }));
  }

  /**
   * Bulk add multiple charges (line items) to a single invoice.
   * Significantly reduces database queries during POS checkout.
   */
  async addChargesBulk(data: {
    invoiceId?: string;
    visitId?: string;
    patientId?: string;
    department: string;
    items: {
      referenceId?: string;
      description: string;
      quantity: number;
      unitPrice: number;
    }[];
  }) {
    return withRetry(async () => {
      // 1. Find or create invoice
      let invoice = null;
      
      if (data.invoiceId) {
        invoice = await prisma.invoice.findUnique({ where: { id: data.invoiceId } });
      } else if (data.visitId) {
        invoice = await prisma.invoice.findFirst({
          where: { visitId: data.visitId, status: "DRAFT" }
        });
      } else if (data.patientId) {
         invoice = await prisma.invoice.findFirst({
          where: { patientId: data.patientId, status: "DRAFT" }
        });
      }

      if (!invoice) {
        invoice = await prisma.invoice.create({
          data: {
            visitId: data.visitId,
            patientId: data.patientId,
            status: "DRAFT",
            subtotal: 0,
            totalAmount: 0
          }
        });
      }

      if (data.items.length === 0) return invoice;

      // 2. Prepare line items and calculate total sum
      const lineItemsData = data.items.map(item => ({
        invoiceId: invoice!.id,
        department: data.department,
        referenceId: item.referenceId,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.quantity * item.unitPrice
      }));

      const totalSum = lineItemsData.reduce((sum, item) => sum + item.total, 0);

      // 3. Execute bulk insert and update invoice sequentially (or via transaction)
      // We do sequential awaits here to keep logic clean, but it's only 2 queries vs N*4 queries
      await prisma.invoiceLineItem.createMany({
        data: lineItemsData
      });

      const updatedInvoice = await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          subtotal: { increment: totalSum },
          totalAmount: { increment: totalSum }
        },
        include: {
          lineItems: true
        }
      });

      return updatedInvoice;
    });
  }
}

export const billingService = new BillingService();

import { PrismaClient } from '@prisma/client';
import { getTimezoneBoundaries } from "../lib/dateUtils.js";

const prisma = new PrismaClient();

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
  }, tx?: any) {
    const db = tx || prisma;
    const unitPrice = Math.round(data.unitPrice * 100) / 100;
    const total = Math.round(data.quantity * unitPrice * 100) / 100;

    // 1. Try to find an open DRAFT invoice for this visit (or patient if walk-in)
    let invoice = null;
    
    if (data.invoiceId) {
      invoice = await db.invoice.findUnique({ where: { id: data.invoiceId } });
    } else if (data.visitId) {
      invoice = await db.invoice.findFirst({
        where: { visitId: data.visitId, status: "DRAFT" }
      });
    } else if (data.patientId) {
       invoice = await db.invoice.findFirst({
        where: { patientId: data.patientId, status: "DRAFT" }
      });
    }

    // 2. If no open invoice, create one
    if (!invoice) {
      invoice = await db.invoice.create({
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
    const lineItem = await db.invoiceLineItem.create({
      data: {
        invoiceId: invoice.id,
        department: data.department,
        referenceId: data.referenceId,
        description: data.description,
        quantity: data.quantity,
        unitPrice: unitPrice,
        total: total
      }
    });

    // 4. Update invoice totals only if it is still DRAFT
    const updatedInvoiceResult = await db.invoice.updateMany({
      where: { id: invoice.id, status: "DRAFT" },
      data: {
        subtotal: { increment: total },
        totalAmount: { increment: total }
      }
    });

    if (updatedInvoiceResult.count === 0) {
      throw new Error("Concurrency error: The invoice is no longer in DRAFT status and cannot be modified. It may have just been checked out.");
    }

    return db.invoice.findUnique({
      where: { id: invoice.id },
      include: { lineItems: true }
    });
  }

  /**
   * Adds multiple charges atomically to a DRAFT invoice (or creates one).
   * Optimized for bulk operations: finds invoice once, createMany line items, updates total once.
   */
  async addChargesBulk(data: {
    invoiceId?: string;
    visitId?: string;
    patientId?: string;
    charges: {
      department: string;
      referenceId?: string;
      description: string;
      quantity: number;
      unitPrice: number;
    }[];
  }, tx?: any) {
    if (!data.charges || data.charges.length === 0) return null;

    const db = tx || prisma;
    let totalToIncrement = 0;
    const formattedCharges: any[] = [];
    
    // 1. Find or create a DRAFT invoice
    let invoice = null;
    if (data.invoiceId) {
      invoice = await db.invoice.findUnique({ where: { id: data.invoiceId } });
    } else if (data.visitId) {
      invoice = await db.invoice.findFirst({ where: { visitId: data.visitId, status: 'DRAFT' } });
    } else if (data.patientId) {
      invoice = await db.invoice.findFirst({ where: { patientId: data.patientId, status: 'DRAFT' } });
    }

    if (!invoice) {
      invoice = await db.invoice.create({
        data: {
          visitId: data.visitId,
          patientId: data.patientId,
          status: 'DRAFT',
          subtotal: 0,
          totalAmount: 0
        }
      });
    }

    data.charges.forEach(charge => {
      const unitPrice = Math.round(charge.unitPrice * 100) / 100;
      const total = Math.round(charge.quantity * unitPrice * 100) / 100;
      totalToIncrement += total;
      formattedCharges.push({
        invoiceId: invoice!.id,
        department: charge.department,
        referenceId: charge.referenceId,
        description: charge.description,
        quantity: charge.quantity,
        unitPrice: unitPrice,
        total: total
      });
    });

    // 2. Bulk insert all line items in a single query
    await db.invoiceLineItem.createMany({
      data: formattedCharges
    });

    // 3. Update invoice totals exactly once, ensuring it is still DRAFT
    const updatedInvoiceResult = await db.invoice.updateMany({
      where: { id: invoice.id, status: "DRAFT" },
      data: {
        subtotal: { increment: totalToIncrement },
        totalAmount: { increment: totalToIncrement }
      }
    });

    if (updatedInvoiceResult.count === 0) {
      throw new Error("Concurrency error: The invoice is no longer in DRAFT status and cannot be modified. It may have just been checked out.");
    }

    return db.invoice.findUnique({
      where: { id: invoice.id },
      include: { lineItems: true }
    });
  }

  /**
   * Fetch an invoice by visit ID or Invoice ID
   */
  async getInvoice(query: { invoiceId?: string, visitId?: string }) {
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
  }

  /**
   * Fetch all invoices
   */
  async getAllInvoices(page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.invoice.findMany({
        include: { lineItems: true, payments: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit
      }),
      prisma.invoice.count()
    ]);
    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Pay an invoice
   */
  async payInvoice(invoiceId: string, amount: number, method: string, tokenId?: string) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new Error("Invoice not found");
      if (invoice.status === "PAID") throw new Error("Invoice is already paid");
      
      // Ensure strict financial integrity
      if (amount < invoice.totalAmount) {
        throw new Error(`Insufficient payment amount. Expected at least ${invoice.totalAmount}, but received ${amount}`);
      }
      
      // Atomic state transition using updateMany to prevent read-modify-write double payment race condition
      const updateResult = await tx.invoice.updateMany({
        where: { id: invoiceId, status: "DRAFT" },
        data: { status: "PAID" }
      });

      if (updateResult.count === 0) {
        throw new Error("Invoice is already paid or being processed concurrently.");
      }

      await tx.payment.create({
        data: {
          invoiceId,
          amount,
          method,
          status: "COMPLETED",
          ...(tokenId ? { tokenId } : {})
        }
      });

      return tx.invoice.findUnique({
        where: { id: invoiceId },
        include: { lineItems: true, payments: true }
      });
    });
  }

  async getCashierMetrics() {
    const { startOfDay } = getTimezoneBoundaries();

    const [pendingInvoices, completedToday, todayGrossRevenueObj, recentPayments, pendingDrafts, todayRefundsObj] = await Promise.all([
      prisma.invoice.aggregate({
        where: { status: 'DRAFT' },
        _count: { _all: true }
      }),
      prisma.payment.aggregate({
        where: { createdAt: { gte: startOfDay }, status: { in: ['COMPLETED', 'REFUNDED'] } },
        _count: { _all: true }
      }),
      prisma.payment.aggregate({
        where: { createdAt: { gte: startOfDay }, status: { in: ['COMPLETED', 'REFUNDED'] } },
        _sum: { amount: true }
      }),
      prisma.payment.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: { invoice: { include: { lineItems: true } } }
      }),
      prisma.invoice.findMany({
        where: { status: 'DRAFT' },
        take: 5,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.refund.aggregate({
        where: { createdAt: { gte: startOfDay }, status: 'COMPLETED' },
        _sum: { amount: true }
      })
    ]);

    const grossRevenue = todayGrossRevenueObj._sum.amount || 0;
    const refunds = todayRefundsObj._sum.amount || 0;
    const totalRevenue = grossRevenue - refunds;
    const cashInDrawer = totalRevenue * 0.4; // Estimate 40% is cash for UI purposes

    const recentTransactions: any[] = [];

    // Map recent drafts
    pendingDrafts.forEach(d => {
      recentTransactions.push({
        id: (d.id.split('-')[0] || '').toUpperCase(),
        patientName: d.patientId || "Walk-in Patient",
        type: "Pending Bill",
        amount: d.totalAmount,
        status: "PENDING",
        time: d.createdAt.toISOString()
      });
    });

    // Map recent payments
    recentPayments.forEach(p => {
      recentTransactions.push({
        id: (p.id.split('-')[0] || '').toUpperCase(),
        patientName: p.invoice?.patientId || "Walk-in Patient",
        type: "Payment",
        amount: p.amount,
        status: p.status,
        time: p.createdAt.toISOString()
      });
    });

    // Sort combined by date desc, take 10
    recentTransactions.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    return {
      pendingPayments: pendingInvoices._count._all,
      processedToday: completedToday._count._all,
      totalRevenue,
      cashInDrawer,
      recentTransactions: recentTransactions.slice(0, 10)
    };
  }

  /**
   * Processes a refund for a specific payment, supporting partial or full refunds.
   */
  async processRefund(paymentId: string, amount: number, reason: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { invoice: true }
    });

    if (!payment) throw new Error("Payment not found");
    if (payment.status !== "COMPLETED") throw new Error("Can only refund completed payments");

    // Calculate existing refunds
    const existingRefunds = await prisma.refund.aggregate({
      where: { paymentId, status: "COMPLETED" },
      _sum: { amount: true }
    });
    const refundedAmount = existingRefunds._sum.amount || 0;

    if (amount > (payment.amount - refundedAmount)) {
      throw new Error(`Refund amount exceeds available payment balance. Available: ${payment.amount - refundedAmount}`);
    }

    const refund = await prisma.refund.create({
      data: {
        paymentId,
        amount,
        reason,
        status: "COMPLETED"
      }
    });

    // If fully refunded, mark the parent records
    if (amount === (payment.amount - refundedAmount)) {
      await prisma.payment.update({
        where: { id: paymentId },
        data: { status: "REFUNDED" }
      });
      await prisma.invoice.update({
        where: { id: payment.invoiceId },
        data: { status: "REFUNDED" }
      });
    }

    return refund;
  }

  /**
   * Remove a line item from a DRAFT invoice and update totals.
   */
  async removeCharge(invoiceId: string, lineItemId: string) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: true }
    });

    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status !== "DRAFT") throw new Error("Can only remove charges from DRAFT invoices");

    const lineItem = invoice.lineItems.find(li => li.id === lineItemId);
    if (!lineItem) throw new Error("Line item not found on this invoice");

    await prisma.invoiceLineItem.delete({ where: { id: lineItemId } });

    return prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        subtotal: { decrement: lineItem.total },
        totalAmount: { decrement: lineItem.total }
      },
      include: { lineItems: true }
    });
  }

  /**
   * Cancel/delete a DRAFT invoice and all its line items.
   */
  async deleteDraftInvoice(invoiceId: string) {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status !== "DRAFT") throw new Error("Can only delete DRAFT invoices");

    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId } });
    await prisma.invoice.delete({ where: { id: invoiceId } });

    return { success: true };
  }
}

export const billingService = new BillingService();

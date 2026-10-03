import { PrismaClient } from '@prisma/client';

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
    const total = data.quantity * data.unitPrice;

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
        unitPrice: data.unitPrice,
        total: total
      }
    });

    // 4. Update invoice totals
    const updatedInvoice = await db.invoice.update({
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
  async getAllInvoices() {
    return prisma.invoice.findMany({
      include: { lineItems: true, payments: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * Pay an invoice
   */
  async payInvoice(invoiceId: string, amount: number, method: string, tokenId?: string) {
    const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "PAID") throw new Error("Invoice is already paid");
    
    // Ensure strict financial integrity
    if (amount < invoice.totalAmount) {
      throw new Error(`Insufficient payment amount. Expected at least ${invoice.totalAmount}, but received ${amount}`);
    }
    
    // In a real system, you'd validate partial payments. Here we assume full payment.
    await prisma.payment.create({
      data: {
        invoiceId,
        amount,
        method,
        status: "COMPLETED",
        ...(tokenId ? { tokenId } : {})
      }
    });

    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: "PAID" },
      include: { lineItems: true, payments: true }
    });

    return updatedInvoice;
  }

  async getCashierMetrics() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [pendingInvoices, completedToday, todayRevenueObj, recentPayments, pendingDrafts] = await Promise.all([
      prisma.invoice.aggregate({
        where: { status: 'DRAFT' },
        _count: { _all: true }
      }),
      prisma.payment.aggregate({
        where: { createdAt: { gte: today }, status: 'COMPLETED' },
        _count: { _all: true }
      }),
      prisma.payment.aggregate({
        where: { createdAt: { gte: today }, status: 'COMPLETED' },
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
      })
    ]);

    const totalRevenue = todayRevenueObj._sum.amount || 0;
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
}

export const billingService = new BillingService();

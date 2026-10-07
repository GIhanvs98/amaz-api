import { prisma } from "../lib/prisma.js";
import { Prisma } from '@prisma/client';
import { getTimezoneBoundaries } from "../lib/dateUtils.js";

export class FinanceService {
  /**
   * Generates the comprehensive dashboard payload required by the frontend
   */
  async getDashboardData() {
    const { startOfDay, firstDayOfMonth } = getTimezoneBoundaries();

    // 1. O(1) Aggregations
    const [
      todayRevenueObj,
      monthlyRevenueObj,
      outstandingInvoices,
      monthlyPurchaseOrders,
      monthlyExpenses,
      todayRefundsObj,
      monthlyRefundsObj
    ] = await Promise.all([
      prisma.payment.aggregate({
        where: { createdAt: { gte: startOfDay }, status: { in: ['COMPLETED', 'REFUNDED'] } },
        _sum: { amount: true }
      }),
      prisma.payment.aggregate({
        where: { createdAt: { gte: firstDayOfMonth }, status: { in: ['COMPLETED', 'REFUNDED'] } },
        _sum: { amount: true }
      }),
      prisma.invoice.aggregate({
        where: { status: 'PENDING' },
        _sum: { totalAmount: true }
      }),
      prisma.purchaseOrder.aggregate({
        where: { orderDate: { gte: firstDayOfMonth }, status: { in: ['DELIVERED', 'COMPLETED'] } },
        _sum: { totalAmount: true }
      }),
      prisma.expense.aggregate({
        where: { date: { gte: firstDayOfMonth }, status: 'COMPLETED' },
        _sum: { amount: true }
      }),
      prisma.refund.aggregate({
        where: { createdAt: { gte: startOfDay }, status: 'COMPLETED' },
        _sum: { amount: true }
      }),
      prisma.refund.aggregate({
        where: { createdAt: { gte: firstDayOfMonth }, status: 'COMPLETED' },
        _sum: { amount: true }
      })
    ]);

    const todayGrossRevenue = todayRevenueObj._sum.amount || 0;
    const monthlyGrossRevenue = monthlyRevenueObj._sum.amount || 0;
    
    const todayRefunds = todayRefundsObj._sum.amount || 0;
    const monthlyRefunds = monthlyRefundsObj._sum.amount || 0;

    const todayRevenue = todayGrossRevenue - todayRefunds;
    const monthlyRevenue = monthlyGrossRevenue - monthlyRefunds;
    
    const outstandingReceivables = outstandingInvoices._sum.totalAmount || 0;
    
    // Total expenses = POs + Misc Expenses (Refunds are contra-revenue, not expenses)
    const totalExpenses = 
      (monthlyPurchaseOrders._sum.totalAmount || 0) + 
      (monthlyExpenses._sum.amount || 0);

    // 2. Fetch recent unified transactions
    const transactions = await this.getUnifiedRecentTransactions();

    // 3. Generate 6-month chart data
    const chartData = await this.getSixMonthChartData();

    return {
      metrics: {
        todayRevenue,
        monthlyRevenue,
        outstandingReceivables,
        totalExpenses
      },
      transactions,
      chartData
    };
  }

  /**
   * Merges Payments (INCOME), PurchaseOrders (EXPENSE) and Generic Expenses (EXPENSE)
   * into a single unified chronological array.
   */
  private async getUnifiedRecentTransactions() {
    const [payments, po, expenses] = await Promise.all([
      prisma.payment.findMany({ take: 5, orderBy: { createdAt: 'desc' }, include: { invoice: { include: { lineItems: true } } } }),
      prisma.purchaseOrder.findMany({ take: 5, orderBy: { createdAt: 'desc' }, include: { supplier: true } }),
      prisma.expense.findMany({ take: 5, orderBy: { date: 'desc' } })
    ]);

    const unified: any[] = [];

    payments.forEach(p => unified.push({
      id: (p.id.split('-')[0] || '').toUpperCase(),
      date: p.createdAt.toISOString(),
      type: 'INCOME',
      category: p.invoice?.lineItems[0]?.department || 'MIXED',
      amount: p.amount,
      status: p.status
    }));

    po.forEach(p => unified.push({
      id: (p.id.split('-')[0] || '').toUpperCase(),
      date: p.createdAt.toISOString(),
      type: 'EXPENSE',
      category: 'SUPPLIES',
      amount: p.totalAmount,
      status: p.status === 'PENDING' ? 'PENDING' : 'COMPLETED'
    }));

    expenses.forEach(e => unified.push({
      id: (e.id.split('-')[0] || '').toUpperCase(),
      date: e.date.toISOString(),
      type: 'EXPENSE',
      category: e.category,
      amount: e.amount,
      status: e.status
    }));

    // Sort descending by date and slice to 10
    return unified.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10);
  }

  /**
   * Generates historical monthly data using Prisma GroupBy or raw queries.
   * For simplicity and cross-db support in Prisma without complex DATE_TRUNC, 
   * we fetch the last 6 months' aggregates.
   */
  private async getSixMonthChartData() {
    const months = [];
    const chartData = [];
    
    // Generate the past 6 months boundaries
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      months.push({ label: start.toLocaleString('default', { month: 'short' }), start, end });
    }

    // Execute sequentially to ensure correct array pushing order
    for (const m of months) {
      const [income, po, exp] = await Promise.all([
        prisma.payment.aggregate({ where: { createdAt: { gte: m.start, lte: m.end }, status: 'COMPLETED' }, _sum: { amount: true } }),
        prisma.purchaseOrder.aggregate({ where: { orderDate: { gte: m.start, lte: m.end }, status: { in: ['DELIVERED', 'COMPLETED'] } }, _sum: { totalAmount: true } }),
        prisma.expense.aggregate({ where: { date: { gte: m.start, lte: m.end }, status: 'COMPLETED' }, _sum: { amount: true } })
      ]);
      
      chartData.push({
        month: m.label,
        income: income._sum.amount || 0,
        expense: (po._sum.totalAmount || 0) + (exp._sum.amount || 0)
      });
    }

    // Keep it ordered chronologically
    return chartData;
  }

  /**
   * Generates a dynamic ledger of payables owed to Doctors for completed appointments.
   * Calculates based on 85% revenue share of the consultation fee.
   */
  async getDoctorSettlements(startDate?: string, endDate?: string) {
    const start = startDate ? new Date(startDate) : new Date(new Date().setHours(0, 0, 0, 0));
    const end = endDate ? new Date(endDate) : new Date(new Date().setHours(23, 59, 59, 999));

    // 1. Get all COMPLETED appointments in the date range
    const appointments = await prisma.appointment.findMany({
      where: {
        completedAt: { gte: start, lte: end },
        status: 'COMPLETED',
        doctorId: { not: null }
      },
      include: {
        User: true
      }
    });

    // 2. Fetch associated invoices to calculate actual paid amounts
    const visitIds = appointments.map(a => a.id);
    const paidInvoices = await prisma.invoice.findMany({
      where: {
        visitId: { in: visitIds },
        status: 'PAID'
      },
      include: {
        lineItems: true
      }
    });

    // 3. Aggregate by Doctor
    const settlementMap: Record<string, {
      doctorId: string;
      doctorName: string;
      totalConsultations: number;
      totalCollected: number;
      doctorShare: number; // 85%
      hospitalShare: number; // 15%
    }> = {};

    for (const apt of appointments) {
      if (!apt.doctorId || !apt.User) continue;

      const docId = apt.doctorId;
      if (!settlementMap[docId]) {
        settlementMap[docId] = {
          doctorId: docId,
          doctorName: apt.User.fullName,
          totalConsultations: 0,
          totalCollected: 0,
          doctorShare: 0,
          hospitalShare: 0
        };
      }

      // Find the paid invoice for this appointment
      const invoice = paidInvoices.find(inv => inv.visitId === apt.id);
      if (invoice) {
        // Find the consultation line item
        const consultItem = invoice.lineItems.find(li => li.department === 'CONSULTATION');
        if (consultItem) {
          settlementMap[docId].totalConsultations += 1;
          settlementMap[docId].totalCollected += consultItem.total;
          
          // 85% to doctor, 15% to hospital
          const docCut = consultItem.total * 0.85;
          settlementMap[docId].doctorShare += docCut;
          settlementMap[docId].hospitalShare += (consultItem.total - docCut);
        }
      }
    }

    // Convert map to array
    return Object.values(settlementMap).sort((a, b) => b.totalCollected - a.totalCollected);
  }

  // --- Expenses API ---

  async addExpense(data: { category: string; amount: number; description: string; date?: string }) {
    return prisma.expense.create({
      data: {
        category: data.category,
        amount: Number(data.amount),
        description: data.description,
        date: data.date ? new Date(data.date) : new Date(),
        status: "COMPLETED"
      }
    });
  }

  async getExpenses(page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.expense.findMany({
        orderBy: { date: 'desc' },
        skip,
        take: limit
      }),
      prisma.expense.count()
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

  async updateExpense(id: string, data: { category?: string; amount?: number; description?: string; date?: string }) {
    return prisma.expense.update({
      where: { id },
      data: {
        ...(data.category && { category: data.category }),
        ...(data.amount !== undefined && { amount: Number(data.amount) }),
        ...(data.description && { description: data.description }),
        ...(data.date && { date: new Date(data.date) }),
      }
    });
  }

  async deleteExpense(id: string) {
    return prisma.expense.delete({
      where: { id }
    });
  }

  // --- Purchase Orders API ---

  async createPurchaseOrder(data: { supplierId: string; items: { medicineId: string; quantity: number; unitPrice: number; }[] }) {
    let totalAmount = 0;
    const poItems = data.items.map(item => {
      const totalPrice = Math.round(item.quantity * item.unitPrice * 100) / 100;
      totalAmount = Math.round((totalAmount + totalPrice) * 100) / 100;
      return {
        medicineId: item.medicineId,
        quantity: item.quantity,
        unitPrice: Math.round(item.unitPrice * 100) / 100,
        totalPrice
      };
    });

    return prisma.purchaseOrder.create({
      data: {
        supplierId: data.supplierId,
        totalAmount,
        status: "PENDING",
        items: {
          create: poItems
        }
      },
      include: {
        items: true,
        supplier: true
      }
    });
  }

  async getPurchaseOrders(page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            include: { medicine: true }
          },
          supplier: true
        },
        skip,
        take: limit
      }),
      prisma.purchaseOrder.count()
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

  async updatePurchaseOrderStatus(id: string, status: string) {
    const validStatuses = ['PENDING', 'DELIVERED', 'COMPLETED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    return prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true }
      });

      if (!po) throw new Error('Purchase Order not found');

      // Guard against idempotency issue — no double-delivering
      if (status === 'DELIVERED' && (po.status === 'DELIVERED' || po.status === 'COMPLETED')) {
        throw new Error('This Purchase Order has already been delivered and stock has been received.');
      }

      const updatedPO = await tx.purchaseOrder.update({
        where: { id },
        data: { status },
        include: { items: true, supplier: true }
      });

      // AUTO STOCK RECEIVING: When goods are marked as delivered,
      // automatically create new stock batches for each ordered item.
      if (status === 'DELIVERED') {
        const batchTimestamp = Date.now();
        await Promise.all(
          po.items.map((item, index) =>
            tx.stockBatch.create({
              data: {
                medicineId: item.medicineId,
                batchNumber: `PO-${id.slice(-6).toUpperCase()}-${batchTimestamp + index}`,
                expiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
                initialQuantity: item.quantity,
                currentQuantity: item.quantity,
                unitPrice: item.unitPrice,
              }
            })
          )
        );
      }

      return updatedPO;
    });
  }

  // --- Suppliers API ---

  async createSupplier(data: { name: string; contactPerson?: string; email?: string; phone?: string; address?: string }) {
    return prisma.supplier.create({
      data
    });
  }

  async getSuppliers() {
    return prisma.supplier.findMany({
      orderBy: { name: 'asc' }
    });
  }

  async updateSupplier(id: string, data: { name?: string; contactPerson?: string; email?: string; phone?: string; address?: string }) {
    return prisma.supplier.update({
      where: { id },
      data
    });
  }

  async deleteSupplier(id: string) {
    // Check constraints: if POs exist, prevent delete
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: { _count: { select: { purchaseOrders: true } } }
    });

    if (supplier && supplier._count.purchaseOrders > 0) {
      throw new Error("Cannot delete supplier with existing Purchase Orders.");
    }

    return prisma.supplier.delete({
      where: { id }
    });
  }
}

export const financeService = new FinanceService();

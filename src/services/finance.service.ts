import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';

export class FinanceService {
  /**
   * Generates the comprehensive dashboard payload required by the frontend
   */
  async getDashboardData() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // 1. O(1) Aggregations
    const [
      todayRevenueObj,
      monthlyRevenueObj,
      outstandingInvoices,
      monthlyPurchaseOrders,
      monthlyExpenses,
      monthlyRefunds
    ] = await Promise.all([
      prisma.payment.aggregate({
        where: { createdAt: { gte: today }, status: 'COMPLETED' },
        _sum: { amount: true }
      }),
      prisma.payment.aggregate({
        where: { createdAt: { gte: firstDayOfMonth }, status: 'COMPLETED' },
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
        where: { createdAt: { gte: firstDayOfMonth }, status: 'COMPLETED' },
        _sum: { amount: true }
      })
    ]);

    const todayRevenue = todayRevenueObj._sum.amount || 0;
    const monthlyRevenue = monthlyRevenueObj._sum.amount || 0;
    const outstandingReceivables = outstandingInvoices._sum.totalAmount || 0;
    
    // Total expenses = POs + Misc Expenses + Refunds
    const totalExpenses = 
      (monthlyPurchaseOrders._sum.totalAmount || 0) + 
      (monthlyExpenses._sum.amount || 0) + 
      (monthlyRefunds._sum.amount || 0);

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
}

export const financeService = new FinanceService();

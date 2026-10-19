import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const basePrisma = globalForPrisma.prisma || new PrismaClient();

// Bulletproof Data Integrity: Automatically normalize User.email to lowercase & trim across all Prisma queries
basePrisma.$use(async (params: any, next: any) => {
  if (params.model === 'User') {
    if (params.action === 'create' || params.action === 'update' || params.action === 'upsert') {
      if (params.args?.data?.email && typeof params.args.data.email === 'string') {
        params.args.data.email = params.args.data.email.trim().toLowerCase();
      }
    }
    if (params.action === 'findUnique' || params.action === 'findFirst' || params.action === 'findMany') {
      if (params.args?.where?.email && typeof params.args.where.email === 'string') {
        params.args.where.email = params.args.where.email.trim().toLowerCase();
      }
    }
  }
  return next(params);
});

export const prisma = basePrisma;

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

/**
 * Retries a database operation if it fails due to a transient connection error.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      // Only retry on network/connection errors, not Prisma validation errors
      const errorMsg = error?.message?.toLowerCase() || '';
      if (
        errorMsg.includes("can't reach database server") ||
        errorMsg.includes('connection pool timeout') ||
        errorMsg.includes('timeout') ||
        errorMsg.includes('closed')
      ) {
        console.warn(`[Prisma Retry] Attempt ${attempt}/${maxRetries} failed. Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        // Break and throw immediately if it's a normal application error
        throw error;
      }
    }
  }
  throw lastError;
}

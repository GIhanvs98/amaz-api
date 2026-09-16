import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

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

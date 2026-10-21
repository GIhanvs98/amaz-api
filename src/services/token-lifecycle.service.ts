import { prisma, withRetry } from "../lib/prisma.js";
import { getTimezoneBoundaries } from "../lib/dateUtils.js";
import { websocketService } from "./websocket.service.js";

/**
 * Automatically transitions all uncompleted, non-arrived tokens prior to today into NO_SHOW.
 * Ensures tokens are strictly valid for the day they were booked and never leak into future days.
 */
export async function expirePastTokens(): Promise<number> {
  try {
    const { startOfDay } = getTimezoneBoundaries();

    // Any appointment with appointmentDate before today that was left pending is a NO_SHOW
    const result = await withRetry(() =>
      prisma.appointment.updateMany({
        where: {
          appointmentDate: { lt: startOfDay },
          status: { in: ["BOOKED", "WAITING", "WAITING_FOR_LAB_TEST", "IN_PROGRESS"] }
        },
        data: {
          status: "NO_SHOW"
        }
      })
    );

    if (result.count > 0) {
      console.log(`[TokenLifecycle] Expired ${result.count} past pending tokens to NO_SHOW (prior to ${startOfDay.toISOString()}).`);
      if (websocketService.getIo()) {
        websocketService.getIo().emit("TOKEN_STATUS_UPDATED", { action: "EXPIRED_PAST_TOKENS", count: result.count });
      }
    }

    return result.count;
  } catch (error) {
    console.error("[TokenLifecycle] Error expiring past tokens:", error);
    return 0;
  }
}

/**
 * Automatically transitions all uncompleted, non-dispensed prescriptions prior to today into EXPIRED.
 * Ensures the pending Rx queue strictly reflects prescriptions issued today.
 */
export async function expirePastPrescriptions(): Promise<number> {
  try {
    const { startOfDay } = getTimezoneBoundaries();

    const result = await withRetry(() =>
      prisma.prescription.updateMany({
        where: {
          createdAt: { lt: startOfDay },
          status: { in: ["PENDING", "IN_PROGRESS"] }
        },
        data: {
          status: "EXPIRED"
        }
      })
    );

    if (result.count > 0) {
      console.log(`[TokenLifecycle] Expired ${result.count} past pending prescriptions to EXPIRED (prior to ${startOfDay.toISOString()}).`);
      if (websocketService.getIo()) {
        websocketService.getIo().emit("prescription_status_updated", { action: "EXPIRED_PAST_PRESCRIPTIONS", count: result.count });
      }
    }

    return result.count;
  } catch (error) {
    console.error("[TokenLifecycle] Error expiring past prescriptions:", error);
    return 0;
  }
}

let schedulerTimer: NodeJS.Timeout | null = null;

/**
 * Initializes the automated day resetting cycle:
 * 1. Executes immediately on server startup.
 * 2. Runs recurring check to cleanly expire tokens and prescriptions past midnight in Asia/Colombo.
 */
export function initTokenLifecycleScheduler() {
  // Run on startup
  expirePastTokens().catch(err => console.error("[TokenLifecycle] Startup token expiration failed:", err));
  expirePastPrescriptions().catch(err => console.error("[TokenLifecycle] Startup prescription expiration failed:", err));

  // Run every 30 minutes
  if (!schedulerTimer) {
    schedulerTimer = setInterval(() => {
      expirePastTokens().catch(err => console.error("[TokenLifecycle] Periodic token expiration failed:", err));
      expirePastPrescriptions().catch(err => console.error("[TokenLifecycle] Periodic prescription expiration failed:", err));
    }, 30 * 60 * 1000);

    // Ensure timer does not prevent process exit in test environments
    if (schedulerTimer.unref) {
      schedulerTimer.unref();
    }
  }
}

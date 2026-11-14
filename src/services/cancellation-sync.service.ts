import { prisma } from "../lib/prisma.js";
import { websocketService } from "./websocket.service.js";

export interface CancellationSyncResult {
  cancelledAppointments: number;
  cancelledLabRequests: number;
  cancelledExtraOrders: number;
  visitIdentifiers: string[];
}

/**
 * Synchronizes cancellation status across Appointments, Laboratory Requests, and Extra Service Orders.
 * When a frontdesk token or booking is cancelled or refunded, this ensures that clinical workstations
 * (Lab, Nursing, ECG, Dressing) do not perform sessions for cancelled/refunded services.
 */
export async function synchronizeVisitCancellation(
  primaryIdentifier: string,
  reason: string = "Cancelled / Refunded at Front Desk",
  options?: { userId?: string }
): Promise<CancellationSyncResult> {
  const visitIdentifiers = new Set<string>();
  visitIdentifiers.add(primaryIdentifier);

  // 1. Locate any primary or sibling appointments linked via ID or bookingReference
  const relatedAppointments = await prisma.appointment.findMany({
    where: {
      OR: [
        { id: primaryIdentifier },
        { bookingReference: primaryIdentifier }
      ]
    },
    select: { id: true, bookingReference: true }
  });

  relatedAppointments.forEach(apt => {
    visitIdentifiers.add(apt.id);
    if (apt.bookingReference) {
      visitIdentifiers.add(apt.bookingReference);
    }
  });

  // If a bookingReference was found, find all sibling appointments under this same visit cycle
  const bookingRefs = Array.from(visitIdentifiers).filter(Boolean);
  if (bookingRefs.length > 0) {
    const siblingAppts = await prisma.appointment.findMany({
      where: {
        bookingReference: { in: bookingRefs }
      },
      select: { id: true, bookingReference: true }
    });
    siblingAppts.forEach(s => {
      visitIdentifiers.add(s.id);
      if (s.bookingReference) visitIdentifiers.add(s.bookingReference);
    });
  }

  // Also check if an Invoice exists with visitId matching any identifier
  const linkedInvoices = await prisma.invoice.findMany({
    where: {
      visitId: { in: Array.from(visitIdentifiers) }
    },
    select: { id: true, visitId: true }
  });
  linkedInvoices.forEach(inv => {
    if (inv.visitId) visitIdentifiers.add(inv.visitId);
  });

  const allVisitIds = Array.from(visitIdentifiers);

  // 2. Cancel linked Appointments that are not yet COMPLETED
  const aptUpdateResult = await prisma.appointment.updateMany({
    where: {
      id: { in: allVisitIds },
      status: { notIn: ["COMPLETED", "CANCELLED"] }
    },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancellationReason: reason
    }
  });

  // 3. Cancel linked LabRequests that are not yet COMPLETED or PUBLISHED
  const labUpdateResult = await prisma.labRequest.updateMany({
    where: {
      visitId: { in: allVisitIds },
      status: { notIn: ["COMPLETED", "PUBLISHED", "CANCELLED"] }
    },
    data: {
      status: "CANCELLED"
    }
  });

  // 4. Cancel linked ExtraServiceOrders that are not yet COMPLETED
  const extraOrderUpdateResult = await prisma.extraServiceOrder.updateMany({
    where: {
      visitId: { in: allVisitIds },
      status: { notIn: ["COMPLETED", "CANCELLED"] }
    },
    data: {
      status: "CANCELLED",
      notes: reason
    }
  });

  // 5. Broadcast real-time WebSocket notifications to workstations
  if (labUpdateResult.count > 0) {
    websocketService.broadcast("lab_request_cancelled", {
      visitIds: allVisitIds,
      reason,
      cancelledCount: labUpdateResult.count
    });
    websocketService.broadcast("lab_queue_updated", {
      visitIds: allVisitIds
    });
  }

  if (extraOrderUpdateResult.count > 0) {
    websocketService.broadcast("extra_service_order_cancelled", {
      visitIds: allVisitIds,
      reason,
      cancelledCount: extraOrderUpdateResult.count
    });
    websocketService.broadcast("extra_services_queue_updated", {
      visitIds: allVisitIds
    });
  }

  if (options?.userId) {
    try {
      await prisma.activityLog.create({
        data: {
          entityType: "Visit",
          entityId: primaryIdentifier,
          action: "VISIT_CANCEL_REFUND_SYNC",
          description: `Cancelled sync: ${aptUpdateResult.count} appts, ${labUpdateResult.count} labs, ${extraOrderUpdateResult.count} extra services. Reason: ${reason}`,
          userId: options.userId
        }
      });
    } catch (logErr) {
      console.warn("Could not log activity for synchronizeVisitCancellation:", logErr);
    }
  }

  return {
    cancelledAppointments: aptUpdateResult.count,
    cancelledLabRequests: labUpdateResult.count,
    cancelledExtraOrders: extraOrderUpdateResult.count,
    visitIdentifiers: allVisitIds
  };
}


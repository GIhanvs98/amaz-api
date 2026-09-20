import { prisma, withRetry } from "../lib/prisma.js";
import { SMSService } from "./sms.service.js";

export class NotificationService {
  /**
   * Fetch a template from DB, parse variables, and queue SMS.
   * SMS delivery is fire-and-forget (non-blocking) to prevent booking latency.
   */
  static async sendTemplatedSMS(
    patientId: string,
    phone: string,
    templateName: string,
    variables: Record<string, string>
  ) {
    return withRetry(async () => {
      let template = await prisma.smsTemplate.findUnique({ where: { name: templateName } });

      // Fallback templates if not in DB — only used if template doesn't exist at all, not if it is explicitly inactive
      if (!template) {
        if (templateName === 'APPOINTMENT_BOOKED') {
          template = {
            id: 'temp', name: 'APPOINTMENT_BOOKED', isActive: true, createdAt: new Date(), updatedAt: new Date(),
            content: 'Dear {{patientName}}, your appointment with {{doctorName}} is confirmed for {{appointmentDate}}. Your token is {{tokenNumber}}. - {{hospitalName}}'
          };
        } else if (templateName === 'DOCTOR_ARRIVED') {
          template = {
            id: 'temp', name: 'DOCTOR_ARRIVED', isActive: true, createdAt: new Date(), updatedAt: new Date(),
            content: 'Your doctor has arrived. Please proceed to AMAZ Hospital for your appointment. Token: {{tokenNumber}}.'
          };
        } else {
          console.warn(`SMS Template ${templateName} not found in DB and no fallback available.`);
          return null;
        }
      }

      // Explicitly inactive templates should NOT fall back — return null cleanly
      if (!template.isActive) {
        console.info(`SMS Template '${templateName}' is inactive. Skipping.`);
        return null;
      }

      let message = template.content;
      for (const [key, value] of Object.entries(variables)) {
        message = message.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }

      // Create Notification Job record
      const job = await prisma.notificationJob.create({
        data: {
          patientId,
          phoneNumber: phone,
          message,
          status: "PENDING"
        }
      });

      // Fire SMS asynchronously — do NOT await. This prevents SMS latency from blocking the booking response.
      setImmediate(async () => {
        try {
          const success = await SMSService.sendSMS(phone, message);
          await withRetry(() => prisma.notificationJob.update({
            where: { id: job.id },
            data: { 
              status: success ? "SENT" : "FAILED",
              sentAt: success ? new Date() : null,
              errorReason: success ? null : "Gateway rejected"
            }
          }));
        } catch (e: any) {
          await withRetry(() => prisma.notificationJob.update({
            where: { id: job.id },
            data: { status: "FAILED", errorReason: e.message }
          })).catch(console.error); // Prevent unhandled rejection in background
        }
      });

      // Return the job record immediately — SMS is in-flight
      return job;
    });
  }

  static async triggerDoctorArrived(doctorId: string, sessionDate: Date) {
    return withRetry(async () => {
      const startOfDay = new Date(sessionDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(sessionDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Find all appointments that have been BOOKED but not yet arrived/completed/cancelled
      const appointments = await prisma.appointment.findMany({
        where: {
          doctorId,
          appointmentDate: { gte: startOfDay, lte: endOfDay },
          status: { in: ["BOOKED"] } // Only notify patients who haven't checked in yet
        },
        include: { Patient: true }
      });

      for (const apt of appointments) {
        if (apt.Patient?.phone) {
          // Non-blocking — sendTemplatedSMS already handles fire-and-forget internally
          await this.sendTemplatedSMS(
            apt.patientId,
            apt.Patient.phone,
            'DOCTOR_ARRIVED',
            {
              patientName: apt.Patient.fullName,
              tokenNumber: apt.tokenNumber
            }
          );
        }
      }

      return appointments.length;
    });
  }
}

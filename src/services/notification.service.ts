import { prisma, withRetry } from "../lib/prisma.js";
import { SMSService } from "./sms.service.js";

export class NotificationService {
  static initSweeper() {
    setInterval(async () => {
      try {
        const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
        const pendingJobs = await prisma.notificationJob.findMany({
          where: { status: 'PENDING', createdAt: { lte: fiveMinsAgo } },
          take: 50
        });

        for (const job of pendingJobs) {
          try {
            const success = await SMSService.sendSMS(job.phoneNumber, job.message);
            await prisma.notificationJob.update({
              where: { id: job.id },
              data: {
                status: success ? 'SENT' : 'FAILED',
                sentAt: success ? new Date() : null,
                errorReason: success ? null : 'Gateway rejected (Retry)'
              }
            });
          } catch (e: any) {
            await prisma.notificationJob.update({
              where: { id: job.id },
              data: { status: 'FAILED', errorReason: e.message }
            });
          }
        }
      } catch (error) {
        console.error('Notification sweeper error:', error);
      }
    }, 5 * 60 * 1000); // Run every 5 minutes
  }
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
            content: 'AMAZ Hospital: Token #{{tokenNumber}} confirmed for {{patientName}} with Dr. {{doctorName}} on {{appointmentDate}}. Ref: {{bookingRef}}. Inquiries: 0112345678'
          };
        } else if (templateName === 'DOCTOR_ARRIVED') {
          template = {
            id: 'temp', name: 'DOCTOR_ARRIVED', isActive: true, createdAt: new Date(), updatedAt: new Date(),
            content: 'AMAZ Hospital: Dr. {{doctorName}} has arrived at Room {{roomNumber}}. Token: #{{tokenNumber}}. Please proceed to the consultation area.'
          };
        } else if (templateName === 'LAB_REPORT_READY') {
          template = {
            id: 'temp', name: 'LAB_REPORT_READY', isActive: true, createdAt: new Date(), updatedAt: new Date(),
            content: 'AMAZ Hospital: Lab report for {{patientName}} ({{testProfile}}) is ready. View report: {{reportLink}} Ref: {{referenceNo}}'
          };
        } else if (templateName === 'PATIENT_PORTAL_OTP') {
          template = {
            id: 'temp', name: 'PATIENT_PORTAL_OTP', isActive: true, createdAt: new Date(), updatedAt: new Date(),
            content: 'AMAZ Hospital: Your verification code is {{otp}}. Valid for 5 minutes. Do not share this OTP with anyone.'
          };
        } else if (templateName === 'SESSION_CANCELLED') {
          template = {
            id: 'temp', name: 'SESSION_CANCELLED', isActive: true, createdAt: new Date(), updatedAt: new Date(),
            content: 'AMAZ Hospital: Appointment with Dr. {{doctorName}} on {{date}} is cancelled ({{reason}}). Inquiries: 0112345678'
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

  static async triggerDoctorArrived(doctorId: string, sessionDate: Date, roomNumberParam?: string) {
    return withRetry(async () => {
      const startOfDay = new Date(sessionDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(sessionDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Fetch doctor details and room
      const doctor = await prisma.user.findUnique({
        where: { id: doctorId },
        select: { fullName: true }
      });
      const doctorName = (doctor?.fullName || "Consultant").replace(/^Dr\.?\s*/i, "");

      let roomNumber = roomNumberParam || "";
      if (!roomNumber) {
        const attendance = await prisma.doctorAttendance.findFirst({
          where: {
            doctorId,
            date: { gte: startOfDay, lte: endOfDay }
          },
          include: { room: true }
        });
        roomNumber = attendance?.room?.roomNumber || "Consultation Room";
      }

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
              patientName: apt.Patient.fullName || "Patient",
              doctorName,
              roomNumber,
              tokenNumber: String(apt.tokenNumber)
            }
          );
        }
      }

      return appointments.length;
    });
  }
}

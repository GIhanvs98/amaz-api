import { prisma } from "../lib/prisma.js";
import { SMSService } from "./sms.service.js";

export class NotificationService {
  /**
   * Fetch a template from DB, parse variables, and queue SMS.
   */
  static async sendTemplatedSMS(
    patientId: string,
    phone: string,
    templateName: string,
    variables: Record<string, string>
  ) {
    let template = await prisma.smsTemplate.findUnique({ where: { name: templateName } });

    // Fallback templates if not in DB
    if (!template) {
      if (templateName === 'APPOINTMENT_BOOKED') {
        template = {
          id: 'temp', name: 'APPOINTMENT_BOOKED', isActive: true, createdAt: new Date(), updatedAt: new Date(),
          content: 'Dear {{patientName}}, your appointment with {{doctorName}} is confirmed for {{appointmentDate}}. Your token is {{tokenNumber}}. - {{hospitalName}}'
        };
      } else if (templateName === 'DOCTOR_ARRIVED') {
        template = {
          id: 'temp', name: 'DOCTOR_ARRIVED', isActive: true, createdAt: new Date(), updatedAt: new Date(),
          content: 'Your doctor has arrived. Please proceed to the hospital for your appointment. Token: {{tokenNumber}}.'
        };
      } else {
        throw new Error(`SMS Template ${templateName} not found`);
      }
    }

    if (!template.isActive) return null;

    let message = template.content;
    for (const [key, value] of Object.entries(variables)) {
      message = message.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    // Create Notification Job
    const job = await prisma.notificationJob.create({
      data: {
        patientId,
        phoneNumber: phone,
        message,
        status: "PENDING"
      }
    });

    // In a real system, this would be pushed to a Redis queue.
    // We'll process it immediately for simplicity in this MVP.
    try {
      const success = await SMSService.sendSMS(phone, message);
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: { 
          status: success ? "SENT" : "FAILED",
          sentAt: success ? new Date() : null,
          errorReason: success ? null : "Gateway rejected"
        }
      });
      return success;
    } catch (e: any) {
      await prisma.notificationJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorReason: e.message }
      });
      return false;
    }
  }

  static async triggerDoctorArrived(doctorId: string, sessionDate: Date) {
    const startOfDay = new Date(sessionDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(sessionDate);
    endOfDay.setHours(23, 59, 59, 999);

    const appointments = await prisma.appointment.findMany({
      where: {
        doctorId,
        appointmentDate: { gte: startOfDay, lte: endOfDay },
        status: { in: ["BOOKED", "waiting_for_counsiling_payment"] } // Have not checked in yet
      },
      include: { Patient: true }
    });

    for (const apt of appointments) {
      if (apt.Patient?.phone) {
        // Send SMS to each patient
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
  }
}

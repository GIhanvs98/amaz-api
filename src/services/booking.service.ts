import { prisma } from "../lib/prisma.js";
import { SMSService } from "./sms.service.js";

export class BookingService {
  static async getDoctors() {
    return prisma.user.findMany({
      where: { Role: { name: "Doctor" } },
      select: {
        id: true,
        fullName: true,
        DoctorSchedule: true
      }
    });
  }

  static async getAvailability(doctorId: string, date: string) {
    const dayOfWeek = new Date(date).getDay();
    const schedule = await prisma.doctorSchedule.findFirst({
      where: { doctorId, dayOfWeek, isActive: true }
    });

    if (!schedule) {
      return { available: false, reason: "Doctor does not consult on this day", bookedSlots: 0, totalSlots: 0 };
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const bookedCount = await prisma.token.count({
      where: {
        doctorId,
        appointmentDate: {
          gte: startOfDay,
          lte: endOfDay
        }
      }
    });

    return {
      available: bookedCount < schedule.maxTokens,
      bookedSlots: bookedCount,
      totalSlots: schedule.maxTokens,
      nextToken: bookedCount + 1,
      startTime: schedule.startTime,
      endTime: schedule.endTime
    };
  }

  static async bookPhoneToken(phone: string, fullName: string, doctorId: string, date: string) {
    const availability = await this.getAvailability(doctorId, date);
    if (!availability.available) {
      throw new Error("No slots available for this date");
    }

    const patient = await prisma.patient.upsert({
      where: { phone },
      update: { fullName },
      create: { phone, fullName }
    });

    const appointmentDate = new Date(date);

    const token = await prisma.token.create({
      data: {
        tokenNumber: availability.nextToken!.toString().padStart(3, "0"),
        patientId: patient.id,
        doctorId: doctorId,
        appointmentDate,
        status: "BOOKED"
      },
      include: {
        User: true
      }
    });

    try {
      await SMSService.sendTokenSMS(
        phone,
        token.id.substring(0, 8),
        token.User.fullName,
        token.tokenNumber,
        "Leesons Hospital"
      );
    } catch (e) {
      console.error("Failed to send SMS:", e);
    }

    return token;
  }

  static async markArrived(tokenId: string) {
    const existingToken = await prisma.token.findUnique({ where: { id: tokenId } });
    if (!existingToken) throw new Error("Token not found");
    if (existingToken.status === "ARRIVED") throw new Error("Patient already marked as arrived. Invoice already exists.");

    const token = await prisma.token.update({
      where: { id: tokenId },
      data: { status: "ARRIVED" },
      include: { Patient: true, User: true }
    });

    // Create Invoice for the Cashier
    const invoice = await prisma.invoice.create({
      data: {
        patientId: token.patientId,
        status: "DRAFT",
        subtotal: 1500, // Standard fee
        totalAmount: 1500,
        lineItems: {
          create: {
            department: "CONSULTATION",
            description: `Consultation - ${token.User.fullName}`,
            unitPrice: 1500,
            total: 1500,
            quantity: 1
          }
        }
      }
    });

    return { token, invoice };
  }
}

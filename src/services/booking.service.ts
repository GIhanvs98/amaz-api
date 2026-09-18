import { prisma } from "../lib/prisma.js";
import { NotificationService } from "./notification.service.js";

export class BookingService {
  static async getDoctors() {
    return prisma.user.findMany({
      where: { Role: { name: "Doctor" } },
      select: {
        id: true,
        fullName: true,
        DoctorSchedule: {
          include: {
            sessions: true
          }
        }
      }
    });
  }

  static async getAvailability(doctorId: string, date: string) {
    const dayOfWeek = new Date(date).getDay();
    const session = await prisma.doctorScheduleSession.findFirst({
      where: { 
        dayOfWeek, 
        isActive: true,
        schedule: {
          doctorId,
          validFrom: { lte: new Date(date) },
          OR: [
            { validUntil: null },
            { validUntil: { gte: new Date(date) } }
          ]
        }
      }
    });

    if (!session) {
      return { available: false, reason: "Doctor does not consult on this day", bookedSlots: 0, totalSlots: 0 };
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const existingTokens = await prisma.appointment.findMany({
      where: {
        doctorId,
        appointmentDate: {
          gte: startOfDay,
          lte: endOfDay
        }
      },
      select: { tokenNumber: true, status: true }
    });

    const bookedNumbers = new Set(existingTokens.map(t => parseInt(t.tokenNumber, 10)));
    const tokens = [];
    
    for (let i = 1; i <= session.tokenCapacity; i++) {
      tokens.push({
        tokenNumber: i,
        status: bookedNumbers.has(i) ? "BOOKED" : "AVAILABLE"
      });
    }

    const bookedCount = existingTokens.length;

    return {
      available: bookedCount < session.tokenCapacity,
      bookedSlots: bookedCount,
      totalSlots: session.tokenCapacity,
      tokens,
      startTime: session.startTime,
      endTime: session.endTime
    };
  }

  static async getAvailableDates(doctorId: string) {
    const dates: any[] = [];
    let currentDate = new Date();
    currentDate.setDate(currentDate.getDate() + 1); // Start from tomorrow

    let daysChecked = 0;
    while (dates.length < 5 && daysChecked < 30) {
      const dateString = currentDate.toISOString().split('T')[0] as string;
      const availability = await this.getAvailability(doctorId, dateString);
      
      if (availability.available) {
        dates.push({
          date: dateString,
          availableSlots: availability.totalSlots - availability.bookedSlots,
          totalSlots: availability.totalSlots,
          startTime: availability.startTime,
          endTime: availability.endTime
        });
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
      daysChecked++;
    }

    return dates;
  }

  static async bookPhoneToken(phone: string, fullName: string, doctorId: string, date: string, selectedTokenNumber?: number) {
    const dayOfWeek = new Date(date).getDay();
    const appointmentDate = new Date(date);
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const token = await prisma.$transaction(async (tx) => {
      const session = await tx.doctorScheduleSession.findFirst({
        where: { 
          dayOfWeek, 
          isActive: true,
          schedule: {
            doctorId,
            validFrom: { lte: appointmentDate },
            OR: [
              { validUntil: null },
              { validUntil: { gte: appointmentDate } }
            ]
          }
        }
      });

      if (!session) throw new Error("Doctor is not available on this date");

      // Verify if the token is available
      if (selectedTokenNumber) {
        const existingToken = await tx.appointment.findFirst({
          where: {
            doctorId,
            appointmentDate: { gte: startOfDay, lte: endOfDay },
            tokenNumber: selectedTokenNumber.toString().padStart(3, "0")
          }
        });
        if (existingToken) throw new Error(`Token ${selectedTokenNumber} is already booked`);
        if (selectedTokenNumber > session.tokenCapacity) throw new Error("Invalid token number");
      }

      const bookedCount = await tx.appointment.count({
        where: {
          doctorId,
          appointmentDate: { gte: startOfDay, lte: endOfDay }
        }
      });

      if (bookedCount >= session.tokenCapacity) {
        throw new Error("No slots available for this date");
      }

      const patient = await tx.patient.upsert({
        where: { phone },
        update: { fullName },
        create: { phone, fullName }
      });

      let nextTokenNumberStr = "";
      if (selectedTokenNumber) {
        nextTokenNumberStr = selectedTokenNumber.toString().padStart(3, "0");
      } else {
        // Find next lowest available token
        const existingTokens = await tx.appointment.findMany({
          where: { doctorId, appointmentDate: { gte: startOfDay, lte: endOfDay } },
          select: { tokenNumber: true }
        });
        const bookedNums = new Set(existingTokens.map(t => parseInt(t.tokenNumber, 10)));
        let nextAvailable = 1;
        while (bookedNums.has(nextAvailable) && nextAvailable <= session.tokenCapacity) {
          nextAvailable++;
        }
        nextTokenNumberStr = nextAvailable.toString().padStart(3, "0");
      }

      return await tx.appointment.create({
        data: {
          tokenNumber: nextTokenNumberStr,
          patientId: patient.id,
          doctorId: doctorId,
          appointmentDate,
          sessionId: session.id,
          status: "BOOKED"
        },
        include: {
          User: true
        }
      });
    });

    try {
      await NotificationService.sendTemplatedSMS(
        token.patientId,
        phone,
        'APPOINTMENT_BOOKED',
        {
          patientName: fullName,
          doctorName: token.User?.fullName || 'General Physician',
          appointmentDate: appointmentDate.toLocaleDateString(),
          tokenNumber: token.tokenNumber,
          hospitalName: "AMAZ Hospital"
        }
      );
    } catch (e) {
      console.error("Failed to queue SMS job:", e);
    }

    return token;
  }

  static async markArrived(tokenId: string) {
    const existingToken = await prisma.appointment.findUnique({ where: { id: tokenId } });
    if (!existingToken) throw new Error("Token not found");
    if (existingToken.status === "ARRIVED") throw new Error("Patient already marked as arrived. Invoice already exists.");

    const token = await prisma.appointment.update({
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
            description: `Consultation - ${token.User?.fullName || 'General Physician'}`,
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

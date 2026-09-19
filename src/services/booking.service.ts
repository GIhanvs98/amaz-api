import { prisma, withRetry } from "../lib/prisma.js";
import { NotificationService } from "./notification.service.js";
import { websocketService } from "./websocket.service.js";
import { SMSService } from "./sms.service.js";

export class BookingService {
  static async getDoctors() {
    return withRetry(async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const doctors = await prisma.user.findMany({
        where: { Role: { name: "DOCTOR" } },
        select: {
          id: true,
          fullName: true,
          specialty: true,
          roomNumber: true,
          DoctorAttendance: {
            where: {
              date: { gte: today, lt: tomorrow },
              status: "ARRIVED"
            },
            take: 1
          }
        }
      });

      return doctors.map(doc => {
        const todayAttendance = doc.DoctorAttendance[0];
        return {
          id: doc.id,
          fullName: doc.fullName,
          specialty: doc.specialty,
          // Today's specific room overrides default room
          roomNumber: todayAttendance?.roomNumber || doc.roomNumber,
          isArrived: !!todayAttendance
        };
      });
    });
  }

  static async getAvailability(doctorId: string, date: string) {
    return withRetry(async () => {
      const dayOfWeek = new Date(date).getDay();
      const targetDate = new Date(date);
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const session = await prisma.doctorScheduleSession.findFirst({
        where: { 
          dayOfWeek, 
          isActive: true,
          schedule: {
            doctorId,
            validFrom: { lte: endOfDay },
            OR: [
              { validUntil: null },
              { validUntil: { gte: startOfDay } }
            ]
          }
        }
      });

      if (!session) {
        return { available: false, reason: "Doctor does not consult on this day", bookedSlots: 0, totalSlots: 0, tokens: [] };
      }

      // Check for schedule exceptions (doctor modified or cancelled this specific day)
      const exception = await prisma.doctorScheduleException.findFirst({
        where: {
          scheduleId: session.scheduleId,
          exceptionDate: { gte: startOfDay, lte: endOfDay }
        }
      });

      if (exception?.isUnavailable) {
        return { available: false, reason: "Doctor has marked this day as unavailable", bookedSlots: 0, totalSlots: 0, tokens: [] };
      }

      // Check for approved leave
      const onLeave = await prisma.doctorLeave.findFirst({
        where: {
          scheduleId: session.scheduleId,
          status: "APPROVED",
          startDate: { lte: targetDate },
          endDate: { gte: targetDate }
        }
      });

      if (onLeave) {
        return { available: false, reason: "Doctor is on approved leave", bookedSlots: 0, totalSlots: 0, tokens: [] };
      }

      // Use exception capacity/times if specified
      const effectiveCapacity = exception?.newTokenCapacity ?? session.tokenCapacity;
      const effectiveStartTime = exception?.newStartTime ?? session.startTime;
      const effectiveEndTime = exception?.newEndTime ?? session.endTime;

      const existingTokens = await prisma.appointment.findMany({
        where: {
          doctorId,
          appointmentDate: {
            gte: startOfDay,
            lte: endOfDay
          },
          status: { notIn: ["CANCELLED", "NO_SHOW"] } // Don't count cancelled/no-show as booked
        },
        select: { tokenNumber: true, status: true }
      });

      // Normalize: token numbers are stored as zero-padded 3-char strings e.g. "001" or with prefixes like "MLT-001"
      const bookedNumbers = new Set(existingTokens.map(t => parseInt(t.tokenNumber.replace(/\D/g, ''), 10)));
      const tokens = [];
      
      for (let i = 1; i <= effectiveCapacity; i++) {
        tokens.push({
          tokenNumber: i,
          status: bookedNumbers.has(i) ? "BOOKED" : "AVAILABLE"
        });
      }

      const bookedCount = existingTokens.length;

      return {
        available: bookedCount < effectiveCapacity,
        bookedSlots: bookedCount,
        totalSlots: effectiveCapacity,
        tokens,
        startTime: effectiveStartTime,
        endTime: effectiveEndTime
      };
    });
  }

  static async getAvailableDates(doctorId: string) {
    const dates: any[] = [];
    let currentDate = new Date();
    // Allow checking for today's tokens if there are any remaining.

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

    const token = await withRetry(() => prisma.$transaction(async (tx) => {
      const session = await tx.doctorScheduleSession.findFirst({
        where: { 
          dayOfWeek, 
          isActive: true,
          schedule: {
            doctorId,
            validFrom: { lte: endOfDay },
            OR: [
              { validUntil: null },
              { validUntil: { gte: startOfDay } }
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
        const bookedNums = new Set(existingTokens.map(t => parseInt(t.tokenNumber.replace(/\D/g, ''), 10)));
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
          status: "BOOKED",
          bookingType: "PHONE" // Always set explicitly for phone bookings
        },
        include: {
          User: true
        }
      });
    }));

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

    try {
      const updatedAvailability = await BookingService.getAvailability(doctorId, date);
      websocketService.emitToRoom(`doctor_${doctorId}_${date}`, 'availability_updated', updatedAvailability);
    } catch (e) {
      console.error("Failed to broadcast availability update:", e);
    }

    try {
      SMSService.syncContact(phone, fullName).catch(console.error);
    } catch (e) {
      console.error("Failed to sync contact:", e);
    }

    return token;
  }

  static async markArrived(tokenId: string) {
    return withRetry(async () => {
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
    });
  }
}

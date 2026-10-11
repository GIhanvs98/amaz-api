import { Request, Response } from 'express';
import { roomService } from '../services/room.service.js';
import { prisma } from '../lib/prisma.js';

export class RoomController {
  async getAllRooms(req: Request, res: Response) {
    try {
      const rooms = await roomService.getAllRooms();
      res.json(rooms);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async getRoomById(req: Request, res: Response) {
    try {
      const room = await roomService.getRoomById(req.params.id as string);
      if (!room) {
        return res.status(404).json({ error: 'Room not found' });
      }
      res.json(room);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }

  async createRoom(req: Request, res: Response) {
    try {
      const room = await roomService.createRoom(req.body);
      res.status(201).json(room);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async updateRoom(req: Request, res: Response) {
    try {
      const room = await roomService.updateRoom(req.params.id as string, req.body);
      res.json(room);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async deleteRoom(req: Request, res: Response) {
    try {
      await roomService.deleteRoom(req.params.id as string);
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async updateRoomStatus(req: Request, res: Response) {
    try {
      const room = await roomService.updateRoomStatus(req.params.id as string, req.body.status);
      res.json(room);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getRoomMatrix(req: Request, res: Response) {
    try {
      const { date } = req.query;
      if (!date) return res.status(400).json({ error: "Date is required" });

      const dateStr = (date as string).includes('T') ? (date as string).split('T')[0] : (date as string);
      const targetDate = new Date(`${dateStr}T00:00:00`);
      const startOfDay = new Date(targetDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(targetDate);
      endOfDay.setHours(23, 59, 59, 999);
      const dayOfWeek = startOfDay.getDay(); // 0=Sun, 1=Mon...

      // 1. Fetch all rooms
      const actualRooms = await roomService.getAllRooms();

      // 2. Fetch all DoctorSchedule with sessions active today
      const schedules = await prisma.doctorSchedule.findMany({
        where: {
          validFrom: { lte: endOfDay },
          OR: [{ validUntil: null }, { validUntil: { gte: startOfDay } }]
        },
        include: {
          doctor: {
            select: { id: true, fullName: true, roomId: true, room: true }
          },
          sessions: {
            where: { dayOfWeek, isActive: true },
            include: { room: true }
          },
          exceptions: {
            where: {
              exceptionDate: { gte: startOfDay, lte: endOfDay }
            }
          },
          leaves: {
            where: {
              status: "APPROVED",
              startDate: { lte: endOfDay },
              endDate: { gte: startOfDay }
            }
          }
        }
      });

      // 3. Fetch all doctor attendances for today
      const attendances = await prisma.doctorAttendance.findMany({
        where: {
          date: { gte: startOfDay, lte: endOfDay }
        },
        include: {
          doctor: { select: { id: true, fullName: true, roomId: true, room: true } },
          room: true
        }
      });

      // Map rooms with integrated bookings
      const rooms = actualRooms.map((r: any) => {
        const bookings: any[] = [];
        const processedDoctorIds = new Set<string>();

        // A. Match sessions assigned to this room (either directly via session.roomId,
        // or via doctor default room when session.roomId is null)
        for (const sch of schedules) {
          // If doctor is on approved leave today, skip
          if (sch.leaves && sch.leaves.length > 0) continue;

          // Check if there is an exception for today
          const exception = sch.exceptions?.find(e => {
            const expDateStr = new Date(e.exceptionDate).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
            return expDateStr === dateStr;
          });

          if (exception?.isUnavailable) continue;

          for (const s of sch.sessions) {
            const isAssignedToThisRoom = 
              s.roomId === r.id || 
              (!s.roomId && sch.doctor.roomId === r.id);

            if (!isAssignedToThisRoom) continue;

            // Check if doctor has attendance today
            const docAttendance = attendances.find(a => a.doctorId === sch.doctorId);

            let status = "SCHEDULED";
            if (docAttendance) {
              status = docAttendance.status; // ARRIVED, IN_CONSULTATION, ON_BREAK, LEFT
            }

            bookings.push({
              doctorId: sch.doctorId,
              doctorName: sch.doctor.fullName,
              sessionId: s.id,
              sessionName: s.sessionName,
              startTime: exception?.newStartTime || s.startTime,
              endTime: exception?.newEndTime || s.endTime,
              status,
              tokenCapacity: exception?.newTokenCapacity ?? s.tokenCapacity
            });

            processedDoctorIds.add(sch.doctorId);
          }
        }

        // B. Add any attendances explicitly tied to this room that weren't captured by schedules
        // (e.g. ad-hoc arrivals, emergency walk-ins, room reassignment)
        const roomAttendances = attendances.filter(a => a.roomId === r.id);
        for (const att of roomAttendances) {
          if (!processedDoctorIds.has(att.doctorId)) {
            bookings.push({
              doctorId: att.doctorId,
              doctorName: att.doctor.fullName,
              sessionId: null,
              sessionName: "Consultation",
              startTime: att.expectedStartTime || (att.arrivedAt ? new Date(att.arrivedAt).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }) : "08:00"),
              endTime: att.expectedEndTime || "20:00",
              status: att.status,
              tokenCapacity: 40
            });
            processedDoctorIds.add(att.doctorId);
          }
        }

        // Sort bookings by startTime
        bookings.sort((a, b) => a.startTime.localeCompare(b.startTime));

        // Determine dynamic room status
        let roomStatus = r.status;
        if (roomStatus !== 'MAINTENANCE') {
          const isCurrentlyOccupied = bookings.some(b => 
            b.status === 'ARRIVED' || b.status === 'IN_CONSULTATION'
          );
          roomStatus = isCurrentlyOccupied ? 'OCCUPIED' : 'AVAILABLE';
        }

        return {
          id: r.id,
          name: r.roomNumber,
          department: r.department,
          status: roomStatus,
          description: r.description,
          isActive: r.isActive,
          bookings
        };
      });

      res.json(rooms);
    } catch (error: any) {
      console.error("Failed to fetch room matrix:", error);
      res.status(500).json({ error: "Failed to fetch room matrix" });
    }
  }
}

export const roomController = new RoomController();

import { prisma } from '../lib/prisma.js';
import { websocketService } from './websocket.service.js';

export class RoomService {
  async getAllRooms() {
    return prisma.room.findMany({
      orderBy: { roomNumber: 'asc' }
    });
  }

  async getRoomById(id: string) {
    return prisma.room.findUnique({
      where: { id }
    });
  }

  async createRoom(data: { roomNumber: string; department: string; description?: string }) {
    const existing = await prisma.room.findUnique({ where: { roomNumber: data.roomNumber } });
    if (existing) throw new Error("Room number already exists.");

    const room = await prisma.room.create({ data });
    this.broadcastStatus(room);
    return room;
  }

  async updateRoom(id: string, data: { roomNumber?: string; department?: string; description?: string; isActive?: boolean }) {
    const room = await prisma.room.update({
      where: { id },
      data
    });
    this.broadcastStatus(room);
    return room;
  }

  async deleteRoom(id: string) {
    const [userCount, attendanceCount, labTestCount, extraServiceCount, scheduleCount] = await Promise.all([
      prisma.user.count({ where: { roomId: id } }),
      prisma.doctorAttendance.count({ where: { roomId: id } }),
      prisma.labTest.count({ where: { roomId: id } }),
      prisma.extraService.count({ where: { roomId: id } }),
      prisma.doctorScheduleSession.count({ where: { roomId: id } }),
    ]);

    const totalRefs = userCount + attendanceCount + labTestCount + extraServiceCount + scheduleCount;
    if (totalRefs > 0) {
      const details = [
        userCount > 0 ? `${userCount} staff` : null,
        attendanceCount > 0 ? `${attendanceCount} attendance logs` : null,
        labTestCount > 0 ? `${labTestCount} lab tests` : null,
        extraServiceCount > 0 ? `${extraServiceCount} extra services` : null,
        scheduleCount > 0 ? `${scheduleCount} schedules` : null,
      ].filter(Boolean).join(', ');
      throw new Error(`Cannot delete room: referenced by existing records (${details}). Please reassign them or set room to inactive.`);
    }

    await prisma.room.delete({ where: { id } });
    websocketService.broadcast('ROOM_STATUS_UPDATED', { type: 'ROOM_DELETED', roomId: id });
    return { success: true };
  }

  async updateRoomStatus(id: string, status: string) {
    const room = await prisma.room.update({
      where: { id },
      data: { status }
    });
    this.broadcastStatus(room);
    return room;
  }

  private broadcastStatus(room: any) {
    websocketService.broadcast('ROOM_STATUS_UPDATED', {
      roomId: room.id,
      roomNumber: room.roomNumber,
      department: room.department,
      status: room.status,
      isActive: room.isActive
    });
  }
}

export const roomService = new RoomService();

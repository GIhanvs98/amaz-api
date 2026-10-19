import { prisma } from "../lib/prisma.js";
import bcrypt from 'bcryptjs';

export class UserService {
  /**
   * Get user profile by ID
   */
  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        Role: true,
        room: true
      }
    });
    
    if (!user) throw new Error('User not found');
    
    const { password, ...safeUser } = user;
    return {
      ...safeUser,
      roomNumber: user.room?.roomNumber || null
    };
  }

  /**
   * Update basic profile details
   */
  async updateProfile(userId: string, data: { fullName?: string; email?: string; specialty?: string; roomNumber?: string; roomId?: string }) {
    let normalizedEmail: string | undefined = undefined;
    if (data.email) {
      normalizedEmail = data.email.trim().toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existing && existing.id !== userId) {
        throw new Error('Email already in use');
      }
    }

    let finalRoomId: string | null | undefined = undefined;

    if (data.roomId !== undefined) {
      finalRoomId = data.roomId || null;
    } else if (data.roomNumber !== undefined) {
      const trimmed = data.roomNumber?.trim();
      if (trimmed) {
        let room = await prisma.room.findFirst({
          where: {
            OR: [
              { roomNumber: trimmed },
              { id: trimmed }
            ]
          }
        });
        if (!room) {
          room = await prisma.room.create({
            data: {
              roomNumber: trimmed,
              department: "CONSULTATION",
              status: "AVAILABLE"
            }
          });
        }
        finalRoomId = room.id;
      } else {
        finalRoomId = null;
      }
    }

    const updateData: any = {};
    if (data.fullName !== undefined) updateData.fullName = data.fullName;
    if (normalizedEmail !== undefined) updateData.email = normalizedEmail;
    if (data.specialty !== undefined) updateData.specialty = data.specialty || null;
    if (finalRoomId !== undefined) updateData.roomId = finalRoomId;

    const user = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        Role: true,
        room: true
      }
    });

    const { password, ...safeUser } = user;
    return {
      ...safeUser,
      roomNumber: user.room?.roomNumber || null
    };
  }

  /**
   * Update password
   */
  async updatePassword(userId: string, currentPass: string, newPass: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error('User not found');

    const isValid = await bcrypt.compare(currentPass, user.password);
    if (!isValid) throw new Error('Incorrect current password');

    const hashedNewPassword = await bcrypt.hash(newPass, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedNewPassword }
    });

    return { success: true, message: 'Password updated successfully' };
  }
}

export const userService = new UserService();

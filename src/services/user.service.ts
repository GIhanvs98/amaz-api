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
        Role: true
      }
    });
    
    if (!user) throw new Error('User not found');
    
    const { password, ...safeUser } = user;
    return safeUser;
  }

  /**
   * Update basic profile details
   */
  async updateProfile(userId: string, data: { fullName?: string; email?: string; specialty?: string; roomNumber?: string }) {
    // Check if email is being changed and already exists
    if (data.email) {
      const existing = await prisma.user.findUnique({ where: { email: data.email } });
      if (existing && existing.id !== userId) {
        throw new Error('Email already in use');
      }
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        fullName: data.fullName,
        email: data.email,
        specialty: data.specialty || null,
        roomNumber: data.roomNumber || null
      },
      include: {
        Role: true
      }
    });

    const { password, ...safeUser } = user;
    return safeUser;
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

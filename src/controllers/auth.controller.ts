import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET is not defined in environment variables");

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Return success even if user not found to prevent email enumeration
      res.status(200).json({ message: "If an account with that email exists, a reset link has been sent." });
      return;
    }

    // Generate short-lived JWT for password reset
    const resetToken = jwt.sign(
      { id: user.id, email: user.email, purpose: "PASSWORD_RESET" },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

    // In a real application, send this via email/SMS. 
    // Since we don't have a mailer configured, we'll log it for development/audit purposes.
    console.log(`Password reset link: /reset-password?token=${resetToken}`);
    
    res.status(200).json({ message: "If an account with that email exists, a reset link has been sent." });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      res.status(400).json({ error: "Token and new password are required" });
      return;
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string, purpose: string };
      if (decoded.purpose !== "PASSWORD_RESET") {
        throw new Error("Invalid token purpose");
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);

      await prisma.user.update({
        where: { id: decoded.id },
        data: { password: hashedPassword }
      });

      res.status(200).json({ message: "Password has been successfully reset" });
    } catch (err) {
      res.status(400).json({ error: "Invalid or expired reset token" });
    }
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Please provide email and password" });
      return;
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        Role: {
          include: {
            RolePermission: {
              include: { Permission: true }
            }
          }
        }
      }
    });

    if (!user) {
      console.log(`[LOGIN FAILED] No user found for email: ${normalizedEmail}`);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (!user.isActive) {
      console.log(`[LOGIN FAILED] User is deactivated: ${normalizedEmail}`);
      res.status(403).json({ error: "Account is deactivated or suspended. Please contact the administrator." });
      return;
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log(`[LOGIN FAILED] Password mismatch for: ${normalizedEmail}`);
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    // Generate token
    const token = jwt.sign(
      { id: user.id, roleId: user.roleId, email: user.email },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    const isProd = process.env.NODE_ENV === "production";
    res.cookie("token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    });

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.Role?.name || "Unknown",
        permissions: user.Role?.RolePermission?.filter((rp: any) => 
          rp.Permission.action === "READ" || rp.Permission.action === "ALL"
        ).map((rp: any) => rp.Permission.resource) || [],
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.cookies?.token;
    if (!token) {
      res.status(401).json({ error: "No session token found" });
      return;
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET as string) as { id: string; roleId: string; email: string };
    
    // Find user to return
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: {
        Role: {
          include: {
            RolePermission: {
              include: { Permission: true }
            }
          }
        }
      }
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: "Invalid session or deactivated user" });
      return;
    }

    res.status(200).json({
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.Role?.name || "Unknown",
        permissions: user.Role?.RolePermission?.filter((rp: any) => 
          rp.Permission.action === "READ" || rp.Permission.action === "ALL"
        ).map((rp: any) => rp.Permission.resource) || [],
      }
    });
  } catch (error) {
    res.status(401).json({ error: "Session expired or invalid" });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax"
  });
  res.status(200).json({ message: "Logged out successfully" });
};

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    roleId: string;
    email: string;
  };
}

export const verifyToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    res.status(401).json({ message: "No token provided, authorization denied" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; roleId: string; email: string };
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid token, authorization denied" });
  }
};

export const requirePermission = (action: string, resource: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }

      const rolePermission = await prisma.rolePermission.findFirst({
        where: {
          roleId: req.user.roleId,
          permission: {
            action,
            resource,
          },
        },
      });

      if (!rolePermission) {
        // Check if there is an "ALL" action or resource permission for this role
        const allPermission = await prisma.rolePermission.findFirst({
          where: {
            roleId: req.user.roleId,
            permission: {
              OR: [
                { action: "ALL", resource },
                { action, resource: "ALL" },
                { action: "ALL", resource: "ALL" },
              ],
            },
          },
        });

        if (!allPermission) {
          res.status(403).json({ message: "Forbidden: You don't have required permissions" });
          return;
        }
      }

      next();
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error during permission check" });
    }
  };
};

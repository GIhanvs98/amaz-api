import { Request, Response, NextFunction } from "express";
import redisClient from "../lib/redis.js";

// Add user to Request type for TS
interface AuthRequest extends Request {
    user?: { id: string; roleId: string; email: string };
}

export const cacheMiddleware = (durationInSeconds: number = 60, isUserSpecific: boolean = false) => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        // Caching is globally disabled
        res.setHeader("X-Cache", "DISABLED");
        next();
    };
};

export const clearCache = async (pattern: string) => {
    // Caching is globally disabled
};

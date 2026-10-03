import { Request, Response, NextFunction } from "express";
import redisClient from "../lib/redis.js";

// Add user to Request type for TS
interface AuthRequest extends Request {
    user?: { id: string; roleId: string; email: string };
}

export const cacheMiddleware = (durationInSeconds: number = 60, isUserSpecific: boolean = false) => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        if (req.method !== "GET") {
            return next();
        }

        let key = `cache:${req.originalUrl || req.url}`;
        if (isUserSpecific && req.user) {
            key = `cache:user:${req.user.id}:${req.originalUrl || req.url}`;
        }

        
        try {
            if (redisClient.isOpen) {
                const cachedResponse = await redisClient.get(key);
                
                if (cachedResponse) {
                    res.setHeader("X-Cache", "HIT");
                    res.json(JSON.parse(cachedResponse));
                    return;
                }
                
                // Override res.json to cache the response
                const originalJson = res.json.bind(res);
                res.json = (body: any) => {
                    // Set header
                    res.setHeader("X-Cache", "MISS");
                    // Cache the response
                    if (redisClient.isOpen) {
                        redisClient.setEx(key, durationInSeconds, JSON.stringify(body)).catch(err => {
                            console.error("Redis Cache Set Error:", err);
                        });
                    }
                    
                    // Call the original res.json
                    return originalJson(body);
                };
            }
        } catch (error) {
            console.error("Redis Cache Get Error:", error);
        }
        
        next();
    };
};

export const clearCache = async (pattern: string) => {
    if (!redisClient.isOpen) return;
    try {
        const keys = await redisClient.keys(`cache:${pattern}`);
        if (keys.length > 0) {
            await redisClient.del(keys);
        }
    } catch (error) {
        console.error("Redis Cache Clear Error:", error);
    }
};

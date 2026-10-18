import { Request, Response, NextFunction } from "express";
import redisClient from "../lib/redis.js";

interface AuthRequest extends Request {
    user?: { id: string; roleId: string; email: string };
}

// Resilient in-memory fallback cache
const memoryCache = new Map<string, { data: string; expiry: number }>();

// Periodic memory cache garbage collection every 60s
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of memoryCache.entries()) {
        if (v.expiry < now) {
            memoryCache.delete(k);
        }
    }
}, 60000).unref();

export const cacheMiddleware = (durationInSeconds: number = 60, isUserSpecific: boolean = false) => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        // Only cache safe GET requests
        if (req.method !== "GET") {
            return next();
        }

        const url = req.originalUrl || req.url;
        const key = isUserSpecific && req.user 
            ? `cache:${req.user.id}:${url}` 
            : `cache:${url}`;

        try {
            // 1. Try Redis
            if (redisClient.isReady) {
                const cached = await redisClient.get(key);
                if (cached) {
                    res.setHeader("X-Cache", "HIT-REDIS");
                    res.setHeader("Content-Type", "application/json");
                    return res.send(cached);
                }
            } else {
                // 2. Fallback to memory cache
                const mem = memoryCache.get(key);
                if (mem && mem.expiry > Date.now()) {
                    res.setHeader("X-Cache", "HIT-MEMORY");
                    res.setHeader("Content-Type", "application/json");
                    return res.send(mem.data);
                }
            }
        } catch (err) {
            console.error("Cache read error:", err);
        }

        res.setHeader("X-Cache", "MISS");

        // Intercept response
        const originalSend = res.send.bind(res);
        res.send = (body: any): Response => {
            if (res.statusCode >= 200 && res.statusCode < 300 && body) {
                const dataString = typeof body === "string" ? body : JSON.stringify(body);
                try {
                    if (redisClient.isReady) {
                        redisClient.setEx(key, durationInSeconds, dataString).catch(() => {});
                    } else {
                        memoryCache.set(key, {
                            data: dataString,
                            expiry: Date.now() + durationInSeconds * 1000
                        });
                    }
                } catch (err) {
                    console.error("Cache write error:", err);
                }
            }
            return originalSend(body);
        };

        next();
    };
};

export const clearCache = async (pattern: string) => {
    try {
        const cleanPattern = pattern.replace(/^\//, "");
        
        // Clear memory cache
        for (const k of memoryCache.keys()) {
            if (k.includes(cleanPattern)) {
                memoryCache.delete(k);
            }
        }

        // Clear Redis cache
        if (redisClient.isReady) {
            const keys = await redisClient.keys(`cache:*${cleanPattern}*`);
            if (keys.length > 0) {
                await redisClient.del(keys);
            }
        }
    } catch (err) {
        console.error("Error clearing cache for pattern", pattern, err);
    }
};

import { createClient } from "redis";

const redisClient = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.on("error", (error) => console.error(`Redis Error: ${error}`));
redisClient.on("connect", () => console.log("Redis connected"));

(async () => {
    try {
        await redisClient.connect();
    } catch (err) {
        console.error("Failed to connect to Redis", err);
    }
})();

export default redisClient;

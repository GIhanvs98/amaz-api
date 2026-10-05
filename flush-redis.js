import { createClient } from "redis";
async function run() {
    const client = createClient({ url: "redis://default:YQJgzhbyJBqnWwTAXKZqRaPRjsvKxxKp@tokaido.proxy.rlwy.net:51892" });
    client.on('error', err => console.log('Redis error', err));
    await client.connect();
    await client.flushAll();
    console.log("Redis flushed successfully");
    await client.disconnect();
}
run();

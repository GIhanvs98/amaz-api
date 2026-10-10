import "dotenv/config";
process.env.TZ = "Asia/Colombo";
import app from "./app.js";

import { websocketService } from "./services/websocket.service.js";
import { realandWsService } from "./services/realand-ws.service.js";
import { NotificationService } from "./services/notification.service.js";

const PORT = Number(process.env.PORT) || 5000;

const server = app.listen(PORT, () => {
    console.log(`Amaz Hospital API running on port ${PORT}`);
});

websocketService.initialize(server);
realandWsService.initialize(server);
NotificationService.initSweeper();

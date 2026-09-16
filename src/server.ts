import "dotenv/config";
import app from "./app.js";

import { websocketService } from "./services/websocket.service.js";

const PORT = Number(process.env.PORT) || 5000;

const server = app.listen(PORT, () => {
    console.log(`Amaz Hospital API running on port ${PORT}`);
});

websocketService.initialize(server);
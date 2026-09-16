import { Server as SocketIOServer } from "socket.io";
import { Server as HttpServer } from "http";

class WebSocketService {
  private io: SocketIOServer | null = null;

  public initialize(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: "*", // allow all origins for dev
        methods: ["GET", "POST"]
      }
    });

    this.io.on("connection", (socket) => {
      console.log(`[Socket.io] Client connected: ${socket.id}`);

      // Basic room joining mechanism if needed later
      socket.on("join", (room) => {
        socket.join(room);
        console.log(`[Socket.io] Client ${socket.id} joined room ${room}`);
      });

      socket.on("disconnect", () => {
        console.log(`[Socket.io] Client disconnected: ${socket.id}`);
      });
    });

    console.log("[Socket.io] WebSocket Service initialized.");
  }

  public getIo(): SocketIOServer {
    if (!this.io) {
      throw new Error("WebSocketService is not initialized. Please call initialize() first.");
    }
    return this.io;
  }

  public broadcast(event: string, data: any) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  public emitToRoom(room: string, event: string, data: any) {
    if (this.io) {
      this.io.to(room).emit(event, data);
    }
  }
}

export const websocketService = new WebSocketService();

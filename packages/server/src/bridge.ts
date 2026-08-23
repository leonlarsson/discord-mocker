import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { ClientToServer, ServerToClient } from "@discord-mocker/protocol";
import { type WebSocket, WebSocketServer } from "ws";
import type { Mocker } from "./mocker.js";

/** The websocket the browser UI talks to. Not Discord's protocol — the mocker's own. */
export class BridgeServer {
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(private readonly mocker: Mocker) {
    this.wss.on("connection", (socket) => this.handleConnection(socket));
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit("connection", ws, request);
    });
  }

  private handleConnection(socket: WebSocket): void {
    const send = (message: ServerToClient) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    };

    send({ t: "snapshot", d: this.mocker.snapshot() });
    const unsubscribe = this.mocker.emitter.subscribe(send);

    socket.on("message", (raw) => {
      try {
        this.mocker.handleClientMessage(JSON.parse(raw.toString()) as ClientToServer);
      } catch (error) {
        this.mocker.emitter.record("mocker", "Invalid UI message", String(error));
      }
    });

    socket.on("close", unsubscribe);
    socket.on("error", unsubscribe);
  }

  close(): void {
    this.wss.close();
  }
}

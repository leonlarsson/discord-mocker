import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { MockerConfig } from "@discord-mocker/protocol";
import { type ServerType, serve } from "@hono/node-server";
import { Hono } from "hono";
import { BridgeServer } from "./bridge.js";
import { Mocker } from "./mocker.js";
import { createRestApp } from "./rest.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export interface StartMockerOptions {
  config: MockerConfig;
  /** Directory of built UI assets. Omitted in dev, where Vite serves the UI. */
  webRoot?: string;
}

export interface RunningMocker {
  mocker: Mocker;
  server: ServerType;
  port: number;
  close: () => Promise<void>;
}

/** Serves the built UI, falling back to index.html so client routing works. */
function createStaticHandler(webRoot: string) {
  return async (path: string): Promise<Response | undefined> => {
    const relative = normalize(path === "/" ? "/index.html" : path).replace(/^(\.\.[/\\])+/, "");
    const candidate = join(webRoot, relative);
    const file = existsSync(candidate) ? candidate : join(webRoot, "index.html");
    if (!existsSync(file)) return undefined;
    const body = await readFile(file);
    return new Response(new Uint8Array(body), {
      headers: { "content-type": MIME_TYPES[extname(file)] ?? "application/octet-stream" },
    });
  };
}

export async function startMocker(options: StartMockerOptions): Promise<RunningMocker> {
  const mocker = new Mocker(options.config);
  const bridge = new BridgeServer(mocker);
  const port = options.config.port ?? 5100;

  const app = new Hono();
  app.route("/", createRestApp(mocker));

  if (options.webRoot) {
    const serveStatic = createStaticHandler(options.webRoot);
    app.get("*", async (c) => (await serveStatic(c.req.path)) ?? c.notFound());
  }

  const server = serve({ fetch: app.fetch, port });

  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `Port ${port} is already in use — another mocker is probably running. ` +
                "Stop it, or set a different `port` in mocker.config.ts.",
            )
          : error,
      );
    });
  });

  server.on("upgrade", (request, socket, head) => {
    const path = (request.url ?? "").split("?")[0];
    if (path === "/gateway") {
      mocker.gateway.handleUpgrade(request, socket, head);
    } else if (path === "/__mocker") {
      bridge.handleUpgrade(request, socket, head);
    } else {
      socket.destroy();
    }
  });

  mocker.emitter.record("mocker", `Mocker listening on http://localhost:${port}`);

  return {
    mocker,
    server,
    port,
    close: async () => {
      mocker.close();
      bridge.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

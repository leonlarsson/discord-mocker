import type {
  BridgeSnapshot,
  ClientToServer,
  ServerToClient,
  SubmittedOption,
} from "@discord-mocker/protocol";
import type { APIApplicationCommandOptionChoice } from "discord-api-types/v10";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const INSPECTOR_LIMIT = 500;

export interface Bridge {
  snapshot: BridgeSnapshot | null;
  connected: boolean;
  sendMessage: (channelId: string, userId: string, content: string) => void;
  runCommand: (
    channelId: string,
    userId: string,
    commandId: string,
    options: SubmittedOption[],
  ) => void;
  requestAutocomplete: (input: {
    channelId: string;
    userId: string;
    commandId: string;
    options: SubmittedOption[];
    focused: string;
  }) => Promise<APIApplicationCommandOptionChoice[]>;
}

/**
 * Holds the live mirror of the mocked world.
 *
 * The UI never invents state: every message it shows arrived from the server,
 * which means what you see is exactly what your bot produced.
 */
export function useBridge(): Bridge {
  const [snapshot, setSnapshot] = useState<BridgeSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingAutocomplete = useRef(
    new Map<string, (choices: APIApplicationCommandOptionChoice[]) => void>(),
  );

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/__mocker`);
    socketRef.current = socket;

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);

    socket.onmessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as ServerToClient;

      if (message.t === "autocomplete") {
        pendingAutocomplete.current.get(message.d.nonce)?.(message.d.choices);
        pendingAutocomplete.current.delete(message.d.nonce);
        return;
      }

      setSnapshot((current) => reduce(current, message));
    };

    return () => socket.close();
  }, []);

  const send = useCallback((message: ClientToServer) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const requestAutocomplete = useCallback<Bridge["requestAutocomplete"]>(
    (input) =>
      new Promise((resolve) => {
        const nonce = crypto.randomUUID();
        pendingAutocomplete.current.set(nonce, resolve);
        send({ t: "interaction:autocomplete", d: { ...input, nonce } });
        // A bot that never answers should not wedge the composer.
        setTimeout(() => {
          if (pendingAutocomplete.current.delete(nonce)) resolve([]);
        }, 3000);
      }),
    [send],
  );

  return useMemo(
    () => ({
      snapshot,
      connected,
      sendMessage: (channelId, userId, content) =>
        send({ t: "message:send", d: { channelId, userId, content } }),
      runCommand: (channelId, userId, commandId, options) =>
        send({ t: "interaction:command", d: { channelId, userId, commandId, options } }),
      requestAutocomplete,
    }),
    [snapshot, connected, send, requestAutocomplete],
  );
}

function reduce(current: BridgeSnapshot | null, message: ServerToClient): BridgeSnapshot | null {
  if (message.t === "snapshot") return message.d;
  if (!current) return current;

  switch (message.t) {
    case "message:create": {
      const existing = current.messages[message.d.channelId] ?? [];
      return {
        ...current,
        messages: {
          ...current.messages,
          [message.d.channelId]: [...existing, message.d.message],
        },
      };
    }

    case "message:update": {
      const existing = current.messages[message.d.channelId] ?? [];
      return {
        ...current,
        messages: {
          ...current.messages,
          [message.d.channelId]: existing.map((item) =>
            item.id === message.d.message.id ? message.d.message : item,
          ),
        },
      };
    }

    case "message:delete": {
      const existing = current.messages[message.d.channelId] ?? [];
      return {
        ...current,
        messages: {
          ...current.messages,
          [message.d.channelId]: existing.filter((item) => item.id !== message.d.messageId),
        },
      };
    }

    case "commands":
      return { ...current, commands: message.d };

    case "bot:status":
      return { ...current, bot: message.d };

    case "inspector":
      return {
        ...current,
        inspector: [...current.inspector, message.d].slice(-INSPECTOR_LIMIT),
      };

    default:
      return current;
  }
}

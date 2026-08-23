import type { InspectorDirection, InspectorEntry, ServerToClient } from "@discord-mocker/protocol";
import { generateSnowflake } from "@discord-mocker/protocol";

type Listener = (message: ServerToClient) => void;

/**
 * Fan-out of world changes to every connected UI, plus the rolling inspector log.
 *
 * The log is kept server-side so a browser opened halfway through a session still
 * sees what the bot did before it connected.
 */
export class Emitter {
  private readonly listeners = new Set<Listener>();
  private readonly log: InspectorEntry[] = [];

  constructor(private readonly logLimit = 500) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(message: ServerToClient): void {
    for (const listener of this.listeners) listener(message);
  }

  /** Records an inspector entry and pushes it to every open UI. */
  record(
    direction: InspectorDirection,
    label: string,
    payload?: unknown,
    durationMs?: number,
  ): InspectorEntry {
    const entry: InspectorEntry = {
      id: generateSnowflake(),
      at: Date.now(),
      direction,
      label,
      ...(payload === undefined ? {} : { payload }),
      ...(durationMs === undefined ? {} : { durationMs }),
    };
    this.log.push(entry);
    if (this.log.length > this.logLimit) this.log.shift();
    this.emit({ t: "inspector", d: entry });
    return entry;
  }

  history(): InspectorEntry[] {
    return [...this.log];
  }
}

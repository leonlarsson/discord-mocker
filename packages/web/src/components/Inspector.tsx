import type { InspectorDirection, InspectorEntry } from "@discord-mocker/protocol";
import { useEffect, useRef, useState } from "react";

const FILTERS: Array<{ label: string; directions: InspectorDirection[] }> = [
  { label: "All", directions: [] },
  { label: "Gateway", directions: ["gateway:in", "gateway:out"] },
  { label: "REST", directions: ["rest:request", "rest:response"] },
  { label: "Mocker", directions: ["mocker"] },
];

const DIRECTION_LABELS: Record<InspectorDirection, string> = {
  "gateway:out": "GW →BOT",
  "gateway:in": "GW ←BOT",
  "rest:request": "REST →",
  "rest:response": "REST ←",
  "bot:stdout": "STDOUT",
  "bot:stderr": "STDERR",
  mocker: "MOCKER",
};

/**
 * The devtools half of the tool: every payload that crossed the wire, in order.
 *
 * The clone shows what a user would see; this shows why. Between them there is no
 * step of "add a console.log and restart the bot".
 */
export function Inspector({ entries }: { entries: InspectorEntry[] }) {
  const [filter, setFilter] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = FILTERS[filter] ?? FILTERS[0];
  const visible = entries.filter(
    (entry) => !active?.directions.length || active.directions.includes(entry.direction),
  );

  const newestId = visible.at(-1)?.id;
  useEffect(() => {
    if (newestId) bottomRef.current?.scrollIntoView();
  }, [newestId]);

  return (
    <div className="inspector">
      <div className="inspector-header">
        <span>Inspector</span>
        <span style={{ fontWeight: 400 }}>{visible.length} events</span>
        <div className="inspector-filters">
          {FILTERS.map((option, index) => (
            <button
              key={option.label}
              type="button"
              className={`inspector-filter ${index === filter ? "active" : ""}`}
              onClick={() => setFilter(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="inspector-list">
        {visible.map((entry) => (
          <div key={entry.id}>
            <button
              type="button"
              className="inspector-entry"
              style={{ width: "100%" }}
              onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
            >
              <span className="inspector-time">
                {new Date(entry.at).toLocaleTimeString(undefined, { hour12: false })}
              </span>
              <span className={`inspector-direction ${entry.direction.replace(":", "-")}`}>
                {DIRECTION_LABELS[entry.direction]}
              </span>
              <span className="inspector-label">{entry.label}</span>
              {entry.durationMs !== undefined ? (
                <span className="inspector-duration">{entry.durationMs}ms</span>
              ) : null}
            </button>

            {expanded === entry.id && entry.payload !== undefined ? (
              <pre className="inspector-payload">{JSON.stringify(entry.payload, null, 2)}</pre>
            ) : null}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

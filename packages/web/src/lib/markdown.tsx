import type { BridgeGuild, BridgeUser } from "@discord-mocker/protocol";
import type { ReactNode } from "react";

export interface MentionContext {
  usersById: Map<string, BridgeUser>;
  guild: BridgeGuild | undefined;
}

/**
 * Discord-flavoured markdown, rendered the way the client renders it.
 *
 * Bots emit mentions and formatting constantly, so a mocker that shows raw
 * `<#123>` is showing you something no user would ever see. This covers what bots
 * actually produce; it is deliberately not a general markdown engine.
 */
export function renderContent(content: string, context: MentionContext): ReactNode {
  return renderBlocks(content, context);
}

function renderBlocks(text: string, context: MentionContext): ReactNode {
  const parts: ReactNode[] = [];
  const fence = /```(?:([a-zA-Z0-9+-]*)\n)?([\s\S]*?)```/g;
  let cursor = 0;
  let match = fence.exec(text);
  let key = 0;

  while (match) {
    if (match.index > cursor) {
      parts.push(...renderInline(text.slice(cursor, match.index), context, `pre${key}`));
    }
    parts.push(
      <pre className="md-codeblock" key={`block-${key}`}>
        <code>{match[2]}</code>
      </pre>,
    );
    cursor = match.index + match[0].length;
    key += 1;
    match = fence.exec(text);
  }

  if (cursor < text.length) {
    parts.push(...renderInline(text.slice(cursor), context, `tail${key}`));
  }

  return parts;
}

/** Ordered so that the first match wins — longest/most specific patterns first. */
const INLINE_SOURCE = [
  "`([^`]+)`", // 1: inline code
  "\\*\\*([\\s\\S]+?)\\*\\*", // 2: bold
  "__([\\s\\S]+?)__", // 3: underline
  "\\*([\\s\\S]+?)\\*", // 4: italic
  "_([\\s\\S]+?)_", // 5: italic
  "~~([\\s\\S]+?)~~", // 6: strikethrough
  "\\|\\|([\\s\\S]+?)\\|\\|", // 7: spoiler
  "<@!?(\\d+)>", // 8: user mention
  "<#(\\d+)>", // 9: channel mention
  "<@&(\\d+)>", // 10: role mention
  "<t:(\\d+)(?::([tTdDfFR]))?>", // 11,12: timestamp
  "\\[([^\\]]+)\\]\\((https?://[^)\\s]+)\\)", // 13,14: masked link
  "(https?://[^\\s]+)", // 15: bare link
  "(@everyone|@here)", // 16: global mention
].join("|");

/**
 * A fresh regex per call: nested formatting recurses into `renderInline`, and a
 * shared `lastIndex` across those calls would corrupt the outer scan.
 */
const inlinePattern = () => new RegExp(INLINE_SOURCE, "g");

function renderInline(text: string, context: MentionContext, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;

  const pattern = inlinePattern();
  let match = pattern.exec(text);

  while (match) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const key = `${keyPrefix}-${index}`;
    nodes.push(renderMatch(match, context, key));
    cursor = match.index + match[0].length;
    index += 1;
    match = pattern.exec(text);
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function renderMatch(match: RegExpExecArray, context: MentionContext, key: string): ReactNode {
  const [
    ,
    code,
    bold,
    underline,
    italicStar,
    italicUnderscore,
    strike,
    spoiler,
    userId,
    channelId,
    roleId,
    timestamp,
    timestampStyle,
    linkText,
    linkHref,
    bareLink,
    globalMention,
  ] = match;

  if (code !== undefined)
    return (
      <code className="md-code" key={key}>
        {code}
      </code>
    );
  if (bold !== undefined) return <strong key={key}>{renderInline(bold, context, key)}</strong>;
  if (underline !== undefined) return <u key={key}>{renderInline(underline, context, key)}</u>;
  if (italicStar !== undefined) return <em key={key}>{renderInline(italicStar, context, key)}</em>;
  if (italicUnderscore !== undefined)
    return <em key={key}>{renderInline(italicUnderscore, context, key)}</em>;
  if (strike !== undefined) return <s key={key}>{renderInline(strike, context, key)}</s>;
  if (spoiler !== undefined)
    return (
      <span className="md-spoiler" key={key}>
        {renderInline(spoiler, context, key)}
      </span>
    );

  if (userId !== undefined) {
    const user = context.usersById.get(userId);
    return (
      <span className="md-mention" key={key}>
        @{user?.global_name ?? user?.username ?? "unknown-user"}
      </span>
    );
  }

  if (channelId !== undefined) {
    const channel = context.guild?.channels.find((item) => item.id === channelId);
    const name = channel && "name" in channel ? channel.name : undefined;
    return (
      <span className="md-mention" key={key}>
        #{name ?? "unknown-channel"}
      </span>
    );
  }

  if (roleId !== undefined) {
    const role = context.guild?.roles.find((item) => item.id === roleId);
    const color = role?.color ? `#${role.color.toString(16).padStart(6, "0")}` : undefined;
    return (
      <span
        className="md-mention"
        key={key}
        style={color ? { color, background: `${color}1f` } : undefined}
      >
        @{role?.name ?? "unknown-role"}
      </span>
    );
  }

  if (timestamp !== undefined) {
    return (
      <span className="md-timestamp" key={key}>
        {formatDiscordTimestamp(Number(timestamp) * 1000, timestampStyle)}
      </span>
    );
  }

  if (linkText !== undefined && linkHref !== undefined)
    return (
      <a className="md-link" href={linkHref} target="_blank" rel="noreferrer" key={key}>
        {linkText}
      </a>
    );

  if (bareLink !== undefined)
    return (
      <a className="md-link" href={bareLink} target="_blank" rel="noreferrer" key={key}>
        {bareLink}
      </a>
    );

  if (globalMention !== undefined)
    return (
      <span className="md-mention" key={key}>
        {globalMention}
      </span>
    );

  return match[0];
}

function formatDiscordTimestamp(ms: number, style: string | undefined): string {
  const date = new Date(ms);
  switch (style) {
    case "t":
      return date.toLocaleTimeString(undefined, { timeStyle: "short" });
    case "T":
      return date.toLocaleTimeString();
    case "d":
      return date.toLocaleDateString();
    case "D":
      return date.toLocaleDateString(undefined, { dateStyle: "long" });
    case "R":
      return formatRelative(ms - Date.now());
    default:
      return date.toLocaleString();
  }
}

function formatRelative(deltaMs: number): string {
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(deltaMs) >= size || unit === "second") {
      return formatter.format(Math.round(deltaMs / size), unit);
    }
  }
  return "now";
}

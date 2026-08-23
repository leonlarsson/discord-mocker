import type { BridgeUser } from "@discord-mocker/protocol";
import type { APIEmbed, APIMessage } from "discord-api-types/v10";
import { MessageFlags } from "discord-api-types/v10";
import { type MentionContext, renderContent } from "../lib/markdown.js";
import { Avatar } from "./Avatar.js";
import { type ComponentUseInput, MessageComponents } from "./MessageComponents.js";

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Today at ${time}` : `${date.toLocaleDateString()} ${time}`;
}

function Embed({ embed, context }: { embed: APIEmbed; context: MentionContext }) {
  const color = embed.color ? `#${embed.color.toString(16).padStart(6, "0")}` : "#4f545c";

  return (
    <div className="embed" style={{ borderLeftColor: color }}>
      {embed.author ? <div className="embed-author">{embed.author.name}</div> : null}
      {embed.title ? <div className="embed-title">{embed.title}</div> : null}
      {embed.description ? (
        <div className="embed-description">{renderContent(embed.description, context)}</div>
      ) : null}

      {embed.fields && embed.fields.length > 0 ? (
        <div className="embed-fields">
          {embed.fields.map((field) => (
            <div
              key={`${field.name}-${field.value}`}
              className={`embed-field ${field.inline ? "inline" : ""}`}
            >
              <div className="embed-field-name">{field.name}</div>
              <div className="embed-field-value">{renderContent(field.value, context)}</div>
            </div>
          ))}
        </div>
      ) : null}

      {embed.footer ? <div className="embed-footer">{embed.footer.text}</div> : null}
    </div>
  );
}

interface MessageProps {
  message: APIMessage;
  author: BridgeUser | undefined;
  /** The user who ran the command, for the "used /ping" header. */
  invoker: BridgeUser | undefined;
  grouped: boolean;
  context: MentionContext;
  onComponentUse: (message: APIMessage, input: ComponentUseInput) => void;
}

export function Message({
  message,
  author,
  invoker,
  grouped,
  context,
  onComponentUse,
}: MessageProps) {
  const flags = message.flags ?? 0;
  const isEphemeral = Boolean(flags & MessageFlags.Ephemeral);
  const isLoading = Boolean(flags & MessageFlags.Loading);
  const metadata = "interaction_metadata" in message ? message.interaction_metadata : undefined;
  const commandName = metadata && "name" in metadata ? (metadata.name as string) : undefined;
  const showHeading = !grouped;

  return (
    <div className={`message ${grouped ? "grouped" : ""}`}>
      {commandName && !grouped ? (
        <div className="interaction-header">
          {invoker ? (
            <div
              className="interaction-avatar"
              style={{ background: invoker.avatarColor }}
              aria-hidden
            >
              {invoker.username.charAt(0).toUpperCase()}
            </div>
          ) : null}
          <span>{invoker?.global_name ?? invoker?.username ?? "Someone"} used</span>
          <span className="command">/{commandName}</span>
        </div>
      ) : null}

      {showHeading && author ? (
        <Avatar
          name={author.username}
          color={author.avatarColor}
          size={40}
          className="message-avatar"
        />
      ) : null}

      {showHeading ? (
        <div className="message-heading">
          <span className="message-author">
            {author?.global_name ?? author?.username ?? "Unknown"}
          </span>
          {author?.bot ? <span className="bot-tag">Bot</span> : null}
          <span className="message-timestamp">{formatTimestamp(message.timestamp)}</span>
        </div>
      ) : null}

      {isLoading ? (
        <div className="thinking">
          <span>{author?.global_name ?? author?.username ?? "Bot"} is thinking</span>
          <span className="thinking-dots">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </div>
      ) : (
        <>
          {message.content ? (
            <div className="message-content">
              {renderContent(message.content, context)}
              {message.edited_timestamp ? <span className="message-edited">(edited)</span> : null}
            </div>
          ) : null}

          {message.embeds.map((embed, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: embeds never reorder within a message
            <Embed key={`${embed.title ?? "embed"}-${index}`} embed={embed} context={context} />
          ))}

          {message.components && message.components.length > 0 ? (
            <MessageComponents
              components={message.components}
              context={context}
              onUse={(input) => onComponentUse(message, input)}
            />
          ) : null}
        </>
      )}

      {isEphemeral ? (
        <div className="ephemeral-note">
          <span aria-hidden>👁</span> Only you can see this
        </div>
      ) : null}
    </div>
  );
}

import type { BridgeUser } from "@discord-mocker/protocol";
import type { APIMessage } from "discord-api-types/v10";
import { useEffect, useRef } from "react";
import type { MentionContext } from "../lib/markdown.js";
import { Message } from "./Message.js";
import type { ComponentUseInput } from "./MessageComponents.js";

/** Discord groups consecutive messages from one author within seven minutes. */
const GROUP_WINDOW_MS = 7 * 60 * 1000;

interface MessageListProps {
  channelName: string;
  messages: APIMessage[];
  usersById: Map<string, BridgeUser>;
  context: MentionContext;
  onComponentUse: (message: APIMessage, input: ComponentUseInput) => void;
}

export function MessageList({
  channelName,
  messages,
  usersById,
  context,
  onComponentUse,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  const newest = messages.at(-1);
  const newestKey = newest ? `${newest.id}:${newest.edited_timestamp ?? ""}` : "";
  useEffect(() => {
    if (newestKey) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [newestKey]);

  return (
    <div className="messages">
      <div className="messages-inner">
        <div className="channel-intro">
          <h1 className="channel-intro-title">Welcome to #{channelName}!</h1>
          <p className="channel-intro-body">
            This is the start of the #{channelName} channel. Type <code>/</code> to run one of your
            bot's commands.
          </p>
        </div>

        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const metadata =
            "interaction_metadata" in message ? message.interaction_metadata : undefined;
          const invokerId = metadata && "user" in metadata ? metadata.user.id : undefined;

          const grouped =
            Boolean(previous) &&
            previous?.author.id === message.author.id &&
            !metadata &&
            new Date(message.timestamp).getTime() - new Date(previous?.timestamp ?? 0).getTime() <
              GROUP_WINDOW_MS;

          return (
            <Message
              key={message.id}
              message={message}
              author={usersById.get(message.author.id)}
              invoker={invokerId ? usersById.get(invokerId) : undefined}
              grouped={grouped}
              context={context}
              onComponentUse={onComponentUse}
            />
          );
        })}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

import type { BridgeUser, SubmittedOption } from "@discord-mocker/protocol";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Composer } from "./components/Composer.js";
import { GuildRail } from "./components/GuildRail.js";
import { Inspector } from "./components/Inspector.js";
import { MemberList } from "./components/MemberList.js";
import { MessageList } from "./components/MessageList.js";
import { Sidebar } from "./components/Sidebar.js";
import { useBridge } from "./hooks/useBridge.js";
import { flattenCommands } from "./lib/commands.js";

export function App() {
  const bridge = useBridge();
  const { snapshot } = bridge;

  const [guildId, setGuildId] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [showInspector, setShowInspector] = useState(true);
  const [showMembers, setShowMembers] = useState(true);

  const guild = snapshot?.guilds.find((item) => item.id === guildId) ?? snapshot?.guilds[0];
  const channel = guild?.channels.find((item) => item.id === channelId) ?? guild?.channels[0];
  const activeUserId = userId ?? snapshot?.defaultUserId ?? "";

  // Follow the world when it first arrives, and whenever the guild changes.
  useEffect(() => {
    if (guild && !guildId) setGuildId(guild.id);
    if (channel && !channelId) setChannelId(channel.id);
  }, [guild, channel, guildId, channelId]);

  const usersById = useMemo(
    () => new Map<string, BridgeUser>((snapshot?.users ?? []).map((user) => [user.id, user])),
    [snapshot?.users],
  );

  const invocable = useMemo(() => flattenCommands(snapshot?.commands ?? []), [snapshot?.commands]);

  // Stable identity matters: the composer re-requests autocomplete whenever this
  // callback changes, so an inline arrow here would loop on every render.
  const { requestAutocomplete } = bridge;
  const activeChannelId = channel?.id;
  const handleAutocomplete = useCallback(
    (input: { commandId: string; options: SubmittedOption[]; focused: string }) =>
      activeChannelId
        ? requestAutocomplete({ ...input, channelId: activeChannelId, userId: activeUserId })
        : Promise.resolve([]),
    [requestAutocomplete, activeChannelId, activeUserId],
  );

  const resolver = useMemo(
    () => ({
      userIdByName: (name: string) =>
        [...usersById.values()].find((user) => user.username === name || user.global_name === name)
          ?.id,
      channelIdByName: (name: string) =>
        guild?.channels.find((item) => "name" in item && item.name === name)?.id,
    }),
    [usersById, guild],
  );

  if (!snapshot || !guild || !channel) {
    return (
      <div className="app" style={{ placeContent: "center", color: "var(--text-muted)" }}>
        Connecting to the mocker…
      </div>
    );
  }

  const channelName = channel.name ?? "channel";
  const messages = snapshot.messages[channel.id] ?? [];

  return (
    <div className="app">
      <div className="client">
        <GuildRail
          guilds={snapshot.guilds}
          activeGuildId={guild.id}
          onSelect={(id) => {
            setGuildId(id);
            const next = snapshot.guilds.find((item) => item.id === id);
            setChannelId(next?.channels[0]?.id ?? null);
          }}
        />

        <Sidebar
          guild={guild}
          activeChannelId={channel.id}
          onSelectChannel={setChannelId}
          currentUser={usersById.get(activeUserId)}
          users={snapshot.users}
          onSwitchUser={setUserId}
        />

        <div className="main-column">
          {!bridge.connected ? (
            <div className="disconnected-banner">
              Lost connection to the mocker — is the server still running?
            </div>
          ) : null}

          <header className="channel-header">
            <span className="channel-hash">#</span>
            <span className="channel-header-name">{channelName}</span>
            {"topic" in channel && channel.topic ? (
              <span className="channel-header-topic">{channel.topic}</span>
            ) : null}

            <div className="header-actions">
              <span className="status-chip">
                <span className={`status-dot ${snapshot.bot.connected ? "online" : ""}`} />
                {snapshot.bot.connected
                  ? `${snapshot.bot.user?.username ?? "Bot"} connected`
                  : "No bot connected"}
              </span>
              <button
                type="button"
                className={`toggle-button ${showMembers ? "active" : ""}`}
                onClick={() => setShowMembers((value) => !value)}
              >
                Members
              </button>
              <button
                type="button"
                className={`toggle-button ${showInspector ? "active" : ""}`}
                onClick={() => setShowInspector((value) => !value)}
              >
                Inspector
              </button>
            </div>
          </header>

          <MessageList
            channelName={channelName}
            messages={messages}
            usersById={usersById}
            context={{ usersById, guild }}
            onComponentUse={(message, input) =>
              bridge.sendComponentUse({
                channelId: channel.id,
                userId: activeUserId,
                messageId: message.id,
                ...input,
              })
            }
          />

          <Composer
            channelName={channelName}
            commands={invocable}
            resolver={resolver}
            onSend={(content) => bridge.sendMessage(channel.id, activeUserId, content)}
            onRun={(commandId, options) =>
              bridge.runCommand(channel.id, activeUserId, commandId, options)
            }
            onAutocomplete={handleAutocomplete}
          />

          {showInspector ? <Inspector entries={snapshot.inspector} /> : null}
        </div>

        {showMembers ? <MemberList guild={guild} usersById={usersById} /> : null}
      </div>
    </div>
  );
}

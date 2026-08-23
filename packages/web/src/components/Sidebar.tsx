import type { BridgeGuild, BridgeUser } from "@discord-mocker/protocol";
import { useState } from "react";
import { Avatar } from "./Avatar.js";

interface SidebarProps {
  guild: BridgeGuild;
  activeChannelId: string;
  onSelectChannel: (channelId: string) => void;
  currentUser: BridgeUser | undefined;
  users: BridgeUser[];
  onSwitchUser: (userId: string) => void;
}

export function Sidebar({
  guild,
  activeChannelId,
  onSelectChannel,
  currentUser,
  users,
  onSwitchUser,
}: SidebarProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <div className="sidebar">
      <div className="sidebar-header">{guild.name}</div>

      <div className="channel-list">
        <div className="channel-category">Text Channels</div>
        {guild.channels.map((channel) => (
          <button
            key={channel.id}
            type="button"
            className={`channel ${channel.id === activeChannelId ? "active" : ""}`}
            onClick={() => onSelectChannel(channel.id)}
          >
            <span className="channel-hash">#</span>
            <span>{channel.name ?? "channel"}</span>
          </button>
        ))}
      </div>

      <div className="user-panel">
        <button
          type="button"
          className="user-panel-button"
          onClick={() => setSwitcherOpen((open) => !open)}
        >
          {currentUser ? (
            <Avatar name={currentUser.username} color={currentUser.avatarColor} size={32} />
          ) : null}
          <span className="user-panel-names">
            <span className="user-panel-name">
              {currentUser?.global_name ?? currentUser?.username ?? "—"}
            </span>
            <span className="user-panel-tag">acting as</span>
          </span>
        </button>

        {switcherOpen ? (
          <div className="user-switcher">
            <div className="user-switcher-title">Act as</div>
            {users
              .filter((user) => !user.bot)
              .map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className="user-switcher-item"
                  onClick={() => {
                    onSwitchUser(user.id);
                    setSwitcherOpen(false);
                  }}
                >
                  <Avatar name={user.username} color={user.avatarColor} size={24} />
                  {user.global_name ?? user.username}
                </button>
              ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

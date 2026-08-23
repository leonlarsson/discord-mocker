import type { BridgeGuild } from "@discord-mocker/protocol";

interface GuildRailProps {
  guilds: BridgeGuild[];
  activeGuildId: string;
  onSelect: (guildId: string) => void;
}

export function GuildRail({ guilds, activeGuildId, onSelect }: GuildRailProps) {
  return (
    <nav className="guild-rail">
      {guilds.map((guild) => (
        <button
          key={guild.id}
          type="button"
          className={`guild-pill ${guild.id === activeGuildId ? "active" : ""}`}
          style={{ background: guild.iconColor }}
          title={guild.name}
          onClick={() => onSelect(guild.id)}
        >
          {guild.name
            .split(" ")
            .slice(0, 2)
            .map((word) => word.charAt(0))
            .join("")}
        </button>
      ))}
    </nav>
  );
}

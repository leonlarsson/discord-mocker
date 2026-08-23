import type { MockerConfig } from "@discord-mocker/protocol";

/** The world a mocker boots with when no `mocker.config.ts` is present. */
export const defaultConfig: MockerConfig = {
  port: 5100,
  defaultUser: "leon",
  bot: { username: "Test Bot" },
  users: [
    { username: "leon", globalName: "Leon", avatarColor: "#5865f2" },
    { username: "testuser", globalName: "Test User", avatarColor: "#57f287" },
    { username: "moderator", globalName: "Mod", avatarColor: "#eb459e" },
  ],
  guilds: [
    {
      name: "Mocker Test Server",
      owner: "leon",
      roles: [
        { name: "Admin", color: "#eb459e", permissions: "8", hoist: true },
        { name: "Moderator", color: "#3ba55c", hoist: true },
      ],
      channels: [
        { name: "general", topic: "General chatter" },
        { name: "bot-testing", topic: "Where the bot gets poked" },
      ],
      members: [
        { user: "leon", roles: ["Admin"] },
        { user: "moderator", roles: ["Moderator"] },
        { user: "testuser" },
      ],
    },
  ],
};

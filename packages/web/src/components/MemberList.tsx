import type { BridgeGuild, BridgeUser } from "@discord-mocker/protocol";
import { Avatar } from "./Avatar.js";

interface MemberListProps {
  guild: BridgeGuild;
  usersById: Map<string, BridgeUser>;
}

export function MemberList({ guild, usersById }: MemberListProps) {
  const members = guild.memberIds
    .map((id) => usersById.get(id))
    .filter((user): user is BridgeUser => Boolean(user));

  const bots = members.filter((member) => member.bot);
  const humans = members.filter((member) => !member.bot);

  return (
    <aside className="member-list">
      <div className="member-group-title">Members — {humans.length}</div>
      {humans.map((member) => (
        <div key={member.id} className="member">
          <Avatar name={member.username} color={member.avatarColor} size={32} />
          <span className="member-name">{member.global_name ?? member.username}</span>
        </div>
      ))}

      {bots.length > 0 ? (
        <>
          <div className="member-group-title">Bots — {bots.length}</div>
          {bots.map((member) => (
            <div key={member.id} className="member">
              <Avatar name={member.username} color={member.avatarColor} size={32} />
              <span className="member-name">{member.global_name ?? member.username}</span>
              <span className="bot-tag">Bot</span>
            </div>
          ))}
        </>
      ) : null}
    </aside>
  );
}

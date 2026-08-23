interface AvatarProps {
  name: string;
  color: string;
  size: number;
  className?: string;
}

/** Discord's default avatar: the user's initial on a flat brand colour. */
export function Avatar({ name, color, size, className }: AvatarProps) {
  return (
    <div
      className={`avatar ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: Math.round(size * 0.4),
      }}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

/**
 * Discord snowflake generation.
 *
 * Real snowflakes encode (timestamp, worker, process, increment). Bots in the wild
 * read the timestamp back out of IDs (`SnowflakeUtil.timestampFrom`), so the mocker
 * generates structurally correct IDs rather than random numbers.
 */

/** Discord epoch: 2015-01-01T00:00:00.000Z */
export const DISCORD_EPOCH = 1_420_070_400_000n;

let increment = 0n;

export interface SnowflakeParts {
  timestamp: number;
  workerId: number;
  processId: number;
  increment: number;
}

/** Generates a unique, monotonically increasing snowflake for the given moment. */
export function generateSnowflake(timestamp: number = Date.now()): string {
  increment = (increment + 1n) & 0xfffn;
  const ms = BigInt(timestamp) - DISCORD_EPOCH;
  return ((ms << 22n) | (1n << 17n) | (0n << 12n) | increment).toString();
}

/** Deconstructs a snowflake back into its parts. */
export function deconstructSnowflake(snowflake: string): SnowflakeParts {
  const value = BigInt(snowflake);
  return {
    timestamp: Number((value >> 22n) + DISCORD_EPOCH),
    workerId: Number((value >> 17n) & 0b11111n),
    processId: Number((value >> 12n) & 0b11111n),
    increment: Number(value & 0b111111111111n),
  };
}

/** Builds a deterministic snowflake from a seed, for stable IDs across restarts. */
export function seededSnowflake(seed: string, timestamp = 1_640_995_200_000): string {
  let hash = 0n;
  for (const char of seed) {
    hash = (hash * 31n + BigInt(char.codePointAt(0) ?? 0)) & 0xffffffffn;
  }
  const ms = BigInt(timestamp) - DISCORD_EPOCH;
  return ((ms << 22n) | (hash & 0x3fffffn)).toString();
}

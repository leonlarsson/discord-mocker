#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { MockerConfig } from "@discord-mocker/protocol";
import { defaultConfig, startMocker } from "@discord-mocker/server";

const CONFIG_NAMES = ["mocker.config.ts", "mocker.config.js", "mocker.config.mjs"];

async function loadConfig(cwd: string): Promise<{ config: MockerConfig; source: string }> {
  for (const name of CONFIG_NAMES) {
    const path = join(cwd, name);
    if (!existsSync(path)) continue;

    let module: { default?: MockerConfig };
    try {
      module = (await import(pathToFileURL(path).href)) as { default?: MockerConfig };
    } catch (error) {
      // Node only runs TypeScript directly from 22.18 onward. Say so, rather than
      // letting "Unknown file extension" land in someone's terminal.
      const message = error instanceof Error ? error.message : String(error);
      if (name.endsWith(".ts") && message.includes("Unknown file extension")) {
        throw new Error(
          `Node ${process.versions.node} cannot load ${name} directly. ` +
            "Upgrade to Node 22.18+ (or 24+), or rename the file to mocker.config.js.",
        );
      }
      throw error;
    }

    if (module.default) return { config: module.default, source: name };
  }
  return { config: defaultConfig, source: "built-in defaults" };
}

const cwd = process.cwd();

let config: MockerConfig;
let source: string;
try {
  ({ config, source } = await loadConfig(cwd));
} catch (error) {
  console.error(`\n  discord-mocker could not read your config: ${(error as Error).message}\n`);
  process.exit(1);
}

// The UI is built into the CLI package at publish time; fall back to the workspace
// build during local development.
const here = dirname(fileURLToPath(import.meta.url));
const webCandidates = [join(here, "web"), resolve(here, "../../web/dist")];
const webRoot = webCandidates.find((candidate) => existsSync(candidate));

let running: Awaited<ReturnType<typeof startMocker>>;
try {
  running = await startMocker({ config, ...(webRoot ? { webRoot } : {}) });
} catch (error) {
  console.error(`\n  discord-mocker failed to start: ${(error as Error).message}\n`);
  process.exit(1);
}

if (!webRoot) {
  console.warn("\n  Warning: UI assets not found. Run `pnpm build` to build them.");
}

console.log(`\n  discord-mocker  ->  http://localhost:${running.port}`);
console.log(`  config: ${source}`);
console.log(`  point your bot at: rest: { api: "http://localhost:${running.port}/api" }\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void running.close().then(() => process.exit(0));
  });
}

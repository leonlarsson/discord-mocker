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
    const module = (await import(pathToFileURL(path).href)) as { default?: MockerConfig };
    if (module.default) return { config: module.default, source: name };
  }
  return { config: defaultConfig, source: "built-in defaults" };
}

const cwd = process.cwd();
const { config, source } = await loadConfig(cwd);

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

console.log(`\n  discord-mocker  ->  http://localhost:${running.port}`);
console.log(`  config: ${source}`);
console.log(`  point your bot at: rest: { api: "http://localhost:${running.port}/api" }\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void running.close().then(() => process.exit(0));
  });
}

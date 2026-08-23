import { defaultConfig } from "./defaults.js";
import { startMocker } from "./server.js";

const running = await startMocker({ config: defaultConfig });

console.log(`[mocker] gateway + REST ready on http://localhost:${running.port}`);
console.log("[mocker] point your bot at it with:");
console.log(`  new Client({ intents, rest: { api: "http://localhost:${running.port}/api" } })`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void running.close().then(() => process.exit(0));
  });
}

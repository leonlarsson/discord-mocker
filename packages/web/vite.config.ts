import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** The UI is served by Vite in dev and by the mocker itself once built. */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5101,
    proxy: {
      "/api": "http://localhost:5100",
      "/__mocker": { target: "ws://localhost:5100", ws: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});

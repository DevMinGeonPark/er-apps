import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true,
    // reachable over Tailscale, not just localhost
    allowedHosts: [".ts.net", "localhost"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});

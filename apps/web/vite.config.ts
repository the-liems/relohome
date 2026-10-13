import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/web/api": {
        target: process.env.SIU_GATEWAY_URL || "http://127.0.0.1:8503",
        changeOrigin: false,
      },
    },
  },
  build: { chunkSizeWarningLimit: 1600 },
});

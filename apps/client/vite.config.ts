import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    proxy: {
      "/ctrlx-ws": {
        target: "ws://127.0.0.1:4545",
        ws: true,
        changeOrigin: true
      }
    }
  }
});

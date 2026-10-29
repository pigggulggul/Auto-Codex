import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Atelier uses node:test and runs through its own package script.
    include: ["src/**/*.test.{ts,tsx}", "server/**/*.test.ts", "shared/**/*.test.{ts,mjs}"]
  },
  server: {
    host: "127.0.0.1",
    port: 4780,
    strictPort: true
  },
  preview: {
    host: "127.0.0.1",
    port: 4780,
    strictPort: true
  }
});


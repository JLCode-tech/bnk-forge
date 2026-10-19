import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "fs";

const devProxyTarget =
  process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8000";
const devProxySecure = devProxyTarget.startsWith("https://");

// Read version from VERSION file (check multiple locations for Docker compatibility)
let version = "2.0.0"; // fallback
const versionPaths = [
  path.resolve(__dirname, "../VERSION"), // Local dev (repo root)
  path.resolve(__dirname, "VERSION"), // Docker build (copied to frontend-v2)
  "/VERSION", // Docker absolute path
];
for (const versionPath of versionPaths) {
  if (fs.existsSync(versionPath)) {
    version = fs.readFileSync(versionPath, "utf-8").trim();
    break;
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // WSL2 + Windows-mounted /mnt/* drives don't propagate inotify events,
    // so chokidar misses edits made from outside Vite's process. Polling
    // is the only reliable way to pick up changes on this filesystem.
    watch: {
      // Polling is only needed for WSL2/mnt filesystems (per comment above).
      // On macOS it causes spurious page-reload loops when HMR falls back to
      // full reload (e.g. Fast Refresh incompatible export); FSEvents is fine.
      usePolling: process.platform !== "darwin",
      interval: 300,
    },
    proxy: {
      "/api": {
        target: devProxyTarget,
        changeOrigin: true,
        ws: true,
        secure: devProxySecure,
      },
    },
  },
  build: {
    outDir: "dist",
    // DEVOPS-005: Disable source maps in production to avoid exposing source code
    // Set VITE_SOURCEMAP=true during build to enable for debugging
    sourcemap: process.env.VITE_SOURCEMAP === "true",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("preload-helper") || id.includes("commonjsHelpers")) {
            return "vendor-react";
          }
          if (!id.includes("node_modules")) return undefined;

          // Monaco Editor - very large, only loaded when opening YAML/iRule editor
          if (id.includes("node_modules/monaco-editor/")) {
            return "vendor-monaco";
          }

          // React core - rarely changes
          if (
            id.includes("node_modules/react/") ||
            id.includes("node_modules/react-dom/") ||
            id.includes("node_modules/react-router-dom/") ||
            id.includes("node_modules/react-router/") ||
            id.includes("node_modules/scheduler/")
          ) {
            return "vendor-react";
          }

          // React Query - data fetching library
          if (id.includes("node_modules/@tanstack/")) {
            return "vendor-query";
          }

          // UI components - large but stable (all Radix primitives in one chunk)
          if (
            id.includes("node_modules/@radix-ui/") ||
            id.includes("node_modules/lucide-react/") ||
            id.includes("node_modules/cmdk/")
          ) {
            return "vendor-ui";
          }

          // React Flow - only used in dependency graphs
          if (
            id.includes("node_modules/reactflow/") ||
            id.includes("node_modules/@reactflow/")
          ) {
            return "vendor-flow";
          }

          // Terminal - only used in K8s pods
          if (id.includes("node_modules/@xterm/")) {
            return "vendor-terminal";
          }

          // Forms - used across multiple pages
          if (
            id.includes("node_modules/react-hook-form/") ||
            id.includes("node_modules/@hookform/") ||
            id.includes("node_modules/zod/")
          ) {
            return "vendor-forms";
          }

          // Utilities - small but shared
          if (
            id.includes("node_modules/axios/") ||
            id.includes("node_modules/clsx/") ||
            id.includes("node_modules/tailwind-merge/") ||
            id.includes("node_modules/class-variance-authority/") ||
            id.includes("node_modules/js-yaml/") ||
            id.includes("node_modules/zustand/")
          ) {
            return "vendor-utils";
          }

          return undefined;
        },
      },
    },
  },
});

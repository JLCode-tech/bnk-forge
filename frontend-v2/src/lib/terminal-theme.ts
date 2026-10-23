/**
 * Shared terminal theme and font constants for xterm.js instances.
 * Adheres to Task 7 of UI Consistency Audit (Phase 3):
 * - Font: JetBrains Mono, monospace
 * - ANSI color map matching our semantic palette
 */

export const TERMINAL_FONT_FAMILY = "JetBrains Mono, monospace";
export const TERMINAL_FONT_SIZE = 13;

export function getTerminalTheme(isDark: boolean) {
  return isDark
    ? {
        background: "#0f172a",
        foreground: "#e2e8f0",
        cursor: "#2563eb",
        black: "#000000",
        red: "#ef4444",
        green: "#10b981",
        yellow: "#f59e0b",
        blue: "#3b82f6",
        magenta: "#2563eb",
        cyan: "#06b6d4",
        white: "#e2e8f0",
        brightBlack: "#64748b",
        brightRed: "#f87171",
        brightGreen: "#34d399",
        brightYellow: "#fbbf24",
        brightBlue: "#60a5fa",
        brightMagenta: "#2563eb",
        brightCyan: "#22d3ee",
        brightWhite: "#f1f5f9",
      }
    : {
        background: "#ffffff",
        foreground: "#1e293b",
        cursor: "#2563eb",
        black: "#000000",
        red: "#dc2626",
        green: "#16a34a",
        yellow: "#d97706",
        blue: "#2563eb",
        magenta: "#9333ea",
        cyan: "#0891b2",
        white: "#475569",
        brightBlack: "#94a3b8",
        brightRed: "#ef4444",
        brightGreen: "#22c55e",
        brightYellow: "#f59e0b",
        brightBlue: "#3b82f6",
        brightMagenta: "#a855f7",
        brightCyan: "#06b6d4",
        brightWhite: "#0f172a",
      };
}

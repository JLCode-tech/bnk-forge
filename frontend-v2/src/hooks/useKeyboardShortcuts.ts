import { useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  action: (e: KeyboardEvent) => void;
  description?: string;
  /** If true, shortcut fires even when user is in an input/textarea (default: false) */
  allowInInput?: boolean;
}

/**
 * Global keyboard shortcuts hook with input-awareness.
 * By default, shortcuts are suppressed when the user is typing in an input,
 * textarea, or contentEditable element. Set allowInInput to override.
 *
 * Usage:
 * useKeyboardShortcuts([
 *   { key: 'k', meta: true, action: openCommandPalette, description: 'Open command palette' },
 *   { key: '/', action: focusSearch, description: 'Focus search', allowInInput: true },
 * ]);
 */
export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  enabled: boolean = true,
) {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      for (const shortcut of shortcuts) {
        if (!event.key) continue;
        const metaMatch = shortcut.meta ? event.metaKey || event.ctrlKey : true;
        const ctrlMatch = shortcut.ctrl ? event.ctrlKey : true;
        const shiftMatch = shortcut.shift ? event.shiftKey : true;
        const altMatch = shortcut.alt ? event.altKey : true;
        const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase();

        if (metaMatch && ctrlMatch && shiftMatch && altMatch && keyMatch) {
          // Don't trigger if user is typing in an input (unless allowed)
          const target = event.target as HTMLElement | null;
          const isInput =
            target?.tagName === "INPUT" ||
            target?.tagName === "TEXTAREA" ||
            target?.isContentEditable;

          if (isInput && !shortcut.allowInInput) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          shortcut.action(event);
          return;
        }
      }
    },
    [shortcuts, enabled],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

/**
 * Two-key sequence shortcuts (e.g., G then D = Go to Dashboard).
 *
 * After pressing the leader key (G), a 1-second window opens for the
 * follow-up key. If no follow-up arrives, the sequence resets silently.
 */
export function useSequenceShortcuts(
  sequences: Array<{
    leader: string;
    followUp: string;
    action: () => void;
    description: string;
  }>,
  enabled: boolean = true,
) {
  const leaderRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Skip if user is in an input
      const target = event.target as HTMLElement | null;
      const isInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isInput) return;

      // Skip if modifier keys are pressed (these are for useKeyboardShortcuts)
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (!event.key) return;
      const key = event.key.toLowerCase();

      if (leaderRef.current) {
        // We're in a sequence — check for follow-up
        const leader = leaderRef.current;
        leaderRef.current = null;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }

        for (const seq of sequences) {
          if (
            seq.leader.toLowerCase() === leader &&
            seq.followUp.toLowerCase() === key
          ) {
            event.preventDefault();
            seq.action();
            return;
          }
        }
        // No match — ignore
        return;
      }

      // Check if this key is a leader for any sequence
      const isLeader = sequences.some((s) => s.leader.toLowerCase() === key);
      if (isLeader) {
        leaderRef.current = key;
        // Auto-reset after 1 second
        timerRef.current = setTimeout(() => {
          leaderRef.current = null;
          timerRef.current = null;
        }, 1000);
      }
    },
    [sequences, enabled],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [handleKeyDown]);
}

/**
 * Hook for common navigation shortcuts
 */
export function useNavigationShortcuts() {
  const navigate = useNavigate();

  useKeyboardShortcuts([
    {
      key: "d",
      meta: true,
      action: () => navigate("/"),
      description: "Go to Dashboard",
    },
    {
      key: "p",
      meta: true,
      action: () => navigate("/projects"),
      description: "Go to Workspaces",
    },
    {
      key: "m",
      meta: true,
      action: () => navigate("/catalog"),
      description: "Go to Catalog & Blueprints",
    },
    {
      key: "e",
      meta: true,
      action: () => navigate("/tasks"),
      description: "Go to Activity Log",
    },
  ]);

  // G-then-X sequences — vim-style navigation without modifier keys
  useSequenceShortcuts([
    {
      leader: "g",
      followUp: "d",
      action: () => navigate("/"),
      description: "Go to Dashboard",
    },
    {
      leader: "g",
      followUp: "p",
      action: () => navigate("/projects"),
      description: "Go to Workspaces",
    },
    {
      leader: "g",
      followUp: "m",
      action: () => navigate("/catalog?tab=modules"),
      description: "Go to Modules",
    },
    {
      leader: "g",
      followUp: "f",
      action: () => navigate("/fleet"),
      description: "Go to Cluster Fleet",
    },
    {
      leader: "g",
      followUp: "b",
      action: () => navigate("/bnk"),
      description: "Go to F5 BNK",
    },
    {
      leader: "g",
      followUp: "c",
      action: () => navigate("/cnf"),
      description: "Go to F5 CNF",
    },
    {
      leader: "g",
      followUp: "k",
      action: () => navigate("/kubernetes"),
      description: "Go to Kubernetes",
    },
    {
      leader: "g",
      followUp: "i",
      action: () => navigate("/infrastructure"),
      description: "Go to Infrastructure",
    },
    {
      leader: "g",
      followUp: "o",
      action: () => navigate("/fleet?tab=overview"),
      description: "Go to Operators",
    },
    {
      leader: "g",
      followUp: "t",
      action: () => navigate("/tasks"),
      description: "Go to Activity Log",
    },
    {
      leader: "g",
      followUp: "e",
      action: () => navigate("/benchmarks"),
      description: "Go to Benchmarks",
    },
    {
      leader: "g",
      followUp: "g",
      action: () => navigate("/ai/mcp-gateway"),
      description: "Go to Token Governance and Intelligence",
    },
    {
      leader: "g",
      followUp: "n",
      action: () => navigate("/ai/agents"),
      description: "Go to Agent Fleet",
    },
    {
      leader: "g",
      followUp: "l",
      action: () => navigate("/ai/llm-router"),
      description: "Go to Intelligent Inference",
    },
    {
      leader: "g",
      followUp: "y",
      action: () => navigate("/ai/logs"),
      description: "Go to AI Traffic Logs",
    },
    {
      leader: "g",
      followUp: "a",
      action: () => navigate("/access-methods"),
      description: "Go to Credentials & Registries",
    },
    {
      leader: "g",
      followUp: "r",
      action: () => navigate("/crds"),
      description: "Go to CR Explorer",
    },
    {
      leader: "g",
      followUp: "u",
      action: () => navigate("/users"),
      description: "Go to Users",
    },
    {
      leader: "g",
      followUp: "s",
      action: () => navigate("/system"),
      description: "Go to System",
    },
  ]);
}

/**
 * Get all available keyboard shortcuts
 */
export function getAvailableShortcuts(): KeyboardShortcut[] {
  return [
    {
      key: "k",
      meta: true,
      action: () => {},
      description: "Open command palette",
    },
    {
      key: "/",
      meta: true,
      action: () => {},
      description: "Show keyboard shortcuts",
    },
    {
      key: "d",
      meta: true,
      action: () => {},
      description: "Go to Dashboard",
    },
    {
      key: "p",
      meta: true,
      action: () => {},
      description: "Go to Workspaces",
    },
    {
      key: "m",
      meta: true,
      action: () => {},
      description: "Go to Catalog & Blueprints",
    },
    {
      key: "e",
      meta: true,
      action: () => {},
      description: "Go to Activity Log",
    },
  ];
}

/**
 * Get all available sequence shortcuts for display
 */
export function getSequenceShortcuts(): Array<{
  keys: string;
  description: string;
}> {
  return [
    { keys: "G → D", description: "Go to Dashboard" },
    { keys: "G → P", description: "Go to Workspaces" },
    { keys: "G → F", description: "Go to Cluster Fleet" },
    { keys: "G → B", description: "Go to F5 BNK" },
    { keys: "G → K", description: "Go to Kubernetes" },
    { keys: "G → C", description: "Go to F5 CNF" },
    { keys: "G → I", description: "Go to Infrastructure" },
    { keys: "G → T", description: "Go to Activity Log" },
    { keys: "G → S", description: "Go to System" },
  ];
}

/**
 * Format shortcut for display
 */
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const parts: string[] = [];

  if (shortcut.meta) parts.push("⌘");
  if (shortcut.ctrl) parts.push("Ctrl");
  if (shortcut.shift) parts.push("⇧");
  if (shortcut.alt) parts.push("⌥");

  parts.push(shortcut.key.toUpperCase());

  return parts.join("");
}

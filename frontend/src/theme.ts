import type { CSSProperties } from "react";

/**
 * Zoo design system — "Mission Control".
 *
 * Direction: a dark lab-ops console that makes running the next experiment
 * feel exciting. Deep space-navy canvas with a faint cyan aurora, glassy
 * panels with hairline borders, luminous cyan→violet gradient for THE
 * primary action, glowing telemetry readouts, and semantic colors tuned as
 * translucent tints so status reads like indicator lights, not paint.
 *
 * Components keep the repo's inline-style convention but pull every color,
 * radius, and shadow from here so the app reads as one system. Interaction
 * states (hover/active/focus) that inline styles cannot express live in
 * `index.css`.
 */

export const color = {
  // Neutrals (dark slate/navy scale). "ink" stays the highest-contrast
  // text color so component code reads the same in any theme.
  ink: "#f1f5f9",
  text: "#e2e8f0",
  textSecondary: "#b0bdd4",
  textMuted: "#94a3b8",
  textFaint: "#5d6b85",
  border: "#1e2a44",
  borderStrong: "#31405f",
  canvas: "#070b16",
  surface: "#0e1526",
  surfaceMuted: "#141d33",
  surfaceSunken: "#0a101f",

  // Accent (electric cyan) — focus, live telemetry, active states.
  accent: "#22d3ee",
  accentHover: "#67e8f9",
  accentTint: "rgba(34, 211, 238, 0.10)",
  accentTintBorder: "rgba(34, 211, 238, 0.35)",
  accentText: "#7dedff",

  // The launch gradient — reserved for the one action that starts science.
  launchGradient: "linear-gradient(135deg, #06b6d4 0%, #6366f1 100%)",

  // Semantic — danger (red). #dc2626 is load-bearing: fields.test.tsx
  // asserts it as the required-field error border.
  danger: "#dc2626",
  dangerBg: "rgba(239, 68, 68, 0.10)",
  dangerBorder: "rgba(239, 68, 68, 0.40)",
  dangerText: "#fca5a5",

  // Semantic — warning (amber): unsaved edits, run-in-progress.
  warning: "#f59e0b",
  warningBg: "rgba(245, 158, 11, 0.10)",
  warningBorder: "rgba(245, 158, 11, 0.38)",
  warningText: "#fcd34d",

  // Semantic — success (emerald): connected, valid, complete.
  success: "#34d399",
  successBg: "rgba(52, 211, 153, 0.10)",
  successBorder: "rgba(52, 211, 153, 0.38)",
  successText: "#6ee7b7",
} as const;

export const font = {
  ui: 'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
} as const;

export const shadow = {
  card: "inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 10px 30px rgba(2, 6, 17, 0.45)",
  raised: "inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 14px 40px rgba(2, 6, 17, 0.6)",
  overlay: "0 24px 70px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(148, 163, 184, 0.08)",
  /** Cyan glow for the launch action and live indicators. */
  glow: "0 0 20px rgba(34, 211, 238, 0.28), 0 4px 14px rgba(2, 6, 17, 0.5)",
} as const;

// ---------------------------------------------------------------------------
// Shared style objects
// ---------------------------------------------------------------------------

/** Glassy dark card panel — the basic surface everything sits on. */
export const card: CSSProperties = {
  background: color.surface,
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  boxShadow: shadow.card,
};

/** Standard text/number input. */
export const input: CSSProperties = {
  background: color.surfaceSunken,
  border: `1px solid ${color.borderStrong}`,
  color: color.ink,
  padding: "5px 8px",
  borderRadius: radius.sm,
  fontSize: 13,
  lineHeight: 1.4,
};

/** Field label text above an input. */
export const fieldLabel: CSSProperties = {
  color: color.textMuted,
  fontSize: 12,
  fontWeight: 500,
};

/** Uppercase micro-label for section headers and readout captions. */
export const sectionLabel: CSSProperties = {
  color: color.textFaint,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

/** Panel heading (card titles). */
export const panelTitle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 600,
  color: color.ink,
  letterSpacing: "-0.01em",
};

const btnBase: CSSProperties = {
  borderRadius: radius.sm + 1,
  padding: "6px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  lineHeight: 1.4,
  whiteSpace: "nowrap",
};

export const btn = {
  /** Luminous launch-gradient button — the one primary action on a surface. */
  primary: {
    ...btnBase,
    background: color.launchGradient,
    color: "#ffffff",
    border: "1px solid rgba(103, 232, 249, 0.35)",
    boxShadow: shadow.glow,
    textShadow: "0 1px 2px rgba(2, 6, 17, 0.35)",
  } as CSSProperties,

  /** Outlined dark button — secondary actions. */
  secondary: {
    ...btnBase,
    background: color.surfaceMuted,
    color: color.text,
    border: `1px solid ${color.borderStrong}`,
    fontWeight: 500,
  } as CSSProperties,

  /** Borderless quiet button — tertiary/inline actions. */
  ghost: {
    ...btnBase,
    background: "transparent",
    color: color.textSecondary,
    border: "1px solid transparent",
    fontWeight: 500,
  } as CSSProperties,

  /** Outlined destructive button — stop/cancel/delete. */
  danger: {
    ...btnBase,
    background: "rgba(239, 68, 68, 0.06)",
    color: color.dangerText,
    border: `1px solid ${color.dangerBorder}`,
    fontWeight: 500,
  } as CSSProperties,
} as const;

/** Compact size variant — spread after a btn.* style. */
export const btnSmall: CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
};

const noticeBase: CSSProperties = {
  borderRadius: radius.md,
  fontSize: 12,
  lineHeight: 1.45,
  padding: "8px 12px",
};

export const notice = {
  error: {
    ...noticeBase,
    background: color.dangerBg,
    border: `1px solid ${color.dangerBorder}`,
    color: color.dangerText,
  } as CSSProperties,
  warning: {
    ...noticeBase,
    background: color.warningBg,
    border: `1px solid ${color.warningBorder}`,
    color: color.warningText,
  } as CSSProperties,
  success: {
    ...noticeBase,
    background: color.successBg,
    border: `1px solid ${color.successBorder}`,
    color: color.successText,
  } as CSSProperties,
  info: {
    ...noticeBase,
    background: color.accentTint,
    border: `1px solid ${color.accentTintBorder}`,
    color: color.accentText,
  } as CSSProperties,
} as const;

/** Small rounded status pill (e.g. "Connected", "Running"). */
export const pill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 999,
  padding: "3px 10px",
  fontSize: 12,
  fontWeight: 500,
  lineHeight: 1.4,
};

/** Monospace numeric/text readout (coordinates, filenames, YAML). */
export const mono: CSSProperties = {
  fontFamily: font.mono,
  fontVariantNumeric: "tabular-nums",
};

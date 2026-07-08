import type { CSSProperties } from "react";

/**
 * Zoo design system — the single source of truth for the visual language.
 *
 * Direction: a calm instrument-panel aesthetic for scientists. Soft slate
 * canvas, white cards with hairline borders, one indigo accent, quiet
 * semantic colors, tabular numerals for anything numeric. Components keep
 * the repo's inline-style convention but pull every color, radius, and
 * shadow from here so the app reads as one system.
 *
 * Interaction states (hover/active/focus) that inline styles cannot
 * express live in `index.css` as element-level rules.
 */

export const color = {
  // Neutrals (slate scale)
  ink: "#0f172a",
  text: "#1e293b",
  textSecondary: "#475569",
  textMuted: "#64748b",
  textFaint: "#94a3b8",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  canvas: "#f1f5f9",
  surface: "#ffffff",
  surfaceMuted: "#f8fafc",
  surfaceSunken: "#f1f5f9",

  // Accent (indigo)
  accent: "#4f46e5",
  accentHover: "#4338ca",
  accentTint: "#eef2ff",
  accentTintBorder: "#c7d2fe",
  accentText: "#3730a3",

  // Semantic — danger (red). #dc2626 is load-bearing: fields.test.tsx
  // asserts it as the required-field error border.
  danger: "#dc2626",
  dangerBg: "#fef2f2",
  dangerBorder: "#fecaca",
  dangerText: "#991b1b",

  // Semantic — warning (amber): unsaved edits, run-in-progress.
  warning: "#d97706",
  warningBg: "#fffbeb",
  warningBorder: "#fde68a",
  warningText: "#92400e",

  // Semantic — success (emerald): connected, valid, complete.
  success: "#059669",
  successBg: "#ecfdf5",
  successBorder: "#a7f3d0",
  successText: "#065f46",
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
  card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.06)",
  raised: "0 4px 12px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.05)",
  overlay: "0 20px 50px rgba(15, 23, 42, 0.22), 0 8px 16px rgba(15, 23, 42, 0.1)",
} as const;

// ---------------------------------------------------------------------------
// Shared style objects
// ---------------------------------------------------------------------------

/** White card panel — the basic surface everything sits on. */
export const card: CSSProperties = {
  background: color.surface,
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  boxShadow: shadow.card,
};

/** Standard text/number input. */
export const input: CSSProperties = {
  background: color.surface,
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
  letterSpacing: "0.06em",
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
  /** Filled accent button — the one primary action on a surface. */
  primary: {
    ...btnBase,
    background: color.accent,
    color: "#fff",
    border: `1px solid ${color.accent}`,
  } as CSSProperties,

  /** Outlined neutral button — secondary actions. */
  secondary: {
    ...btnBase,
    background: color.surface,
    color: color.textSecondary,
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
    background: color.surface,
    color: color.danger,
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

// Recharts theme tokens (Sprint v0.8) — keep all chart visuals consistent
// across /progress and /sensors. Mirrors the CSS chart-* variables in
// globals.css so non-Recharts code can reach for the same values.

export const CHART_THEME = {
  // Axis & grid
  axisColor: "rgba(255, 255, 255, 0.20)",
  gridColor: "rgba(255, 255, 255, 0.06)",
  tickColor: "rgba(250, 250, 249, 0.4)",

  // Lines
  primaryLine: "#7DD3FC", // active/current — cyan
  secondaryLine: "rgba(255, 255, 255, 0.4)", // baseline / historical

  // Areas
  areaFill: "rgba(125, 211, 252, 0.08)",

  // Tooltip
  tooltipBg: "rgba(20, 20, 22, 0.95)",
  tooltipBorder: "rgba(255, 255, 255, 0.12)",
  tooltipText: "#FAFAF9",

  // Strokes
  strokeWidth: 1.5,
  axisStrokeWidth: 1,
} as const;

/** Common Recharts <Tooltip> contentStyle. */
export const TOOLTIP_STYLE = {
  background: CHART_THEME.tooltipBg,
  border: `1px solid ${CHART_THEME.tooltipBorder}`,
  borderRadius: 8,
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  color: CHART_THEME.tooltipText,
  fontSize: 12,
} as const;

// Shared chart theming so every chart reads as one system: hairline grid, mono ticks,
// one accent for the subject.

export const C = {
  text: '#f5f5f5',
  text2: '#e2e2e4',
  muted: '#a1a1a6',
  dim: '#7c7c82',
  hairline: '#2c2c2e',
  hairlineLit: '#3a3a3d',
  panel: '#1e1e1f', // card surface (marker rings, gaps)
  // Everpure brand orange, darker step (--ps-color-brand-600): passes the full CVD/contrast
  // validation against series-2 on the card surface; the lighter #ff7023 is the UI accent.
  accent: '#d55d1d',
  accentMuted: '#aa4b17', // --ps-color-brand-700
  series2: '#5b8fd1',
  neutral: '#4a4f57',
};

// Status colours — validated on the card surface; always paired with icon + label.
export const SEVERITY_COLOR = {
  OK: '#7fa88a',
  WARNING: '#e9cf6e',
  HIGH: '#d8843a',
  CRITICAL: '#c63d42',
  INVALID: '#7c7c82',
};

const mono = 'Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace';

/** SVG gradient for bars: solid at the cap, fading toward the baseline. */
export function barGradientId(color) {
  return `grad-${color.replace('#', '')}`;
}

export const axis = {
  stroke: C.hairlineLit,
  tick: { fill: C.dim, fontSize: 10.5, fontFamily: mono },
  tickLine: false,
};

export const grid = { stroke: C.hairline, vertical: false };

// Shared chart theming so every chart reads as one system (element style from
// agent-auto-optimizer: hairline grid, mono ticks, accent for the subject).

export const C = {
  text: '#f3f3f3',
  text2: '#d9dfe7',
  muted: '#949ba5',
  dim: '#6f7681',
  hairline: '#26272b',
  hairlineLit: '#3d4045',
  panel: '#121418',
  accent: '#b87333',
  series2: '#5b8fd1',
  neutral: '#4a4f57',
};

// Status colours — validated on the panel surface; always paired with icon + label.
export const SEVERITY_COLOR = {
  OK: '#7fa88a',
  WARNING: '#e9cf6e',
  HIGH: '#d8843a',
  CRITICAL: '#b8343a',
  INVALID: '#6f7681',
};

const mono = 'Geist Mono, ui-monospace, SFMono-Regular, Menlo, monospace';

export const axis = {
  stroke: C.hairlineLit,
  tick: { fill: C.dim, fontSize: 10.5, fontFamily: mono },
  tickLine: false,
};

export const grid = { stroke: C.hairline, vertical: false };

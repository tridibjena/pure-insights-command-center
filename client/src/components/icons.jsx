// Minimal stroke icons (24px grid, currentColor).
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const BellIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...base}>
    <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
    <path d="M10 20a2.2 2.2 0 0 0 4 0" />
  </svg>
);

export const BellOffIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...base}>
    <path d="M8.5 4.2A6 6 0 0 1 18 9c0 3 .7 4.9 1.4 6" />
    <path d="M6.2 7.3A6 6 0 0 0 6 9c0 6-2.5 7.5-2.5 7.5h13" />
    <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    <path d="M3 3l18 18" />
  </svg>
);

export const ArrowUpRight = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...base} strokeWidth={2}>
    <path d="M7 17 17 7M8 7h9v9" />
  </svg>
);

export const ArrowLeft = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...base} strokeWidth={2}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

export const CloseIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...base} strokeWidth={2}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

/** Up/down sort glyph; the active direction is drawn brighter. */
export const SortIcon = ({ dir }) => (
  <svg width="8" height="11" viewBox="0 0 8 11" aria-hidden="true">
    <path d="M4 0 8 4H0z" fill="currentColor" opacity={dir === 'asc' ? 1 : 0.4} />
    <path d="M4 11 0 7h8z" fill="currentColor" opacity={dir === 'desc' ? 1 : 0.4} />
  </svg>
);

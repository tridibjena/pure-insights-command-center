// Bar marks: a gradient that fades toward the baseline plus a solid cap at the value end,
// so the value edge stays crisp while large fills stay quiet.
import { barGradientId } from '../theme/chart.js';

export function GradientDefs({ colors, horizontal = false }) {
  return (
    <defs>
      {[...new Set(colors)].map((c) => (
        <linearGradient key={c} id={`${barGradientId(c)}${horizontal ? '-h' : ''}`} x1="0" y1="0" x2={horizontal ? 1 : 0} y2={horizontal ? 0 : 1}>
          <stop offset="0%" stopColor={c} stopOpacity={horizontal ? 0.22 : 0.92} />
          <stop offset="100%" stopColor={c} stopOpacity={horizontal ? 0.92 : 0.2} />
        </linearGradient>
      ))}
    </defs>
  );
}

export function CapBar({ x, y, width, height, color, horizontal = false }) {
  if (!width || !height || width < 0 || height < 0) return null;
  const fill = `url(#${barGradientId(color)}${horizontal ? '-h' : ''})`;
  const cap = 2.5;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={2} fill={fill} />
      {horizontal ? (
        <rect x={x + width - cap} y={y} width={cap} height={height} rx={1} fill={color} />
      ) : (
        <rect x={x} y={y} width={width} height={cap} rx={1} fill={color} />
      )}
    </g>
  );
}

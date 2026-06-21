// Tiny dependency-free SVG charts (keeps the GitHub Pages build lean).

export function Histogram({
  counts,
  edges,
  markers = [],
  width = 460,
  height = 160,
}: {
  counts: number[];
  edges: number[];
  markers?: { value: number; label: string; color: string }[];
  width?: number;
  height?: number;
}) {
  const pad = 24;
  const maxC = Math.max(...counts, 1);
  const x0 = edges[0];
  const x1 = edges[edges.length - 1];
  const sx = (v: number) => pad + ((v - x0) / (x1 - x0)) * (width - 2 * pad);
  const bw = (width - 2 * pad) / counts.length;
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="score distribution">
      {counts.map((c, i) => {
        const h = (c / maxC) * (height - 2 * pad);
        return <rect key={i} x={pad + i * bw} y={height - pad - h} width={Math.max(bw - 1, 1)} height={h} fill="#5b8def" />;
      })}
      {markers.map((m, i) => (
        <g key={i}>
          <line x1={sx(m.value)} x2={sx(m.value)} y1={pad / 2} y2={height - pad} stroke={m.color} strokeWidth={2} strokeDasharray="4 3" />
          <text x={sx(m.value)} y={pad / 2} fill={m.color} fontSize="10" textAnchor="middle">{m.label}</text>
        </g>
      ))}
      <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#888" />
      <text x={pad} y={height - 6} fontSize="10" fill="#666">{x0.toFixed(0)}</text>
      <text x={width - pad} y={height - 6} fontSize="10" fill="#666" textAnchor="end">{x1.toFixed(0)}</text>
    </svg>
  );
}

export function LineChart({
  points,
  width = 560,
  height = 180,
  zeroLine = true,
}: {
  points: { x: number; y: number }[];
  width?: number;
  height?: number;
  zeroLine?: boolean;
}) {
  const pad = 30;
  if (points.length === 0) return <p className="muted">No data.</p>;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xmin = Math.min(...xs), xmax = Math.max(...xs);
  const ymin = Math.min(...ys, 0), ymax = Math.max(...ys, 0);
  const sx = (v: number) => pad + ((v - xmin) / (xmax - xmin || 1)) * (width - 2 * pad);
  const sy = (v: number) => height - pad - ((v - ymin) / (ymax - ymin || 1)) * (height - 2 * pad);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="line chart">
      {zeroLine && <line x1={pad} x2={width - pad} y1={sy(0)} y2={sy(0)} stroke="#bbb" strokeDasharray="3 3" />}
      <path d={d} fill="none" stroke="#2e7d32" strokeWidth={2} />
      <text x={pad} y={12} fontSize="10" fill="#666">{ymax.toFixed(1)}</text>
      <text x={pad} y={height - 4} fontSize="10" fill="#666">{ymin.toFixed(1)}</text>
    </svg>
  );
}

export function Scatter({
  points,
  min,
  max,
  width = 320,
  height = 320,
}: {
  points: { pred: number; actual: number }[];
  min: number;
  max: number;
  width?: number;
  height?: number;
}) {
  const pad = 34;
  const sx = (v: number) => pad + ((v - min) / (max - min || 1)) * (width - 2 * pad);
  const sy = (v: number) => height - pad - ((v - min) / (max - min || 1)) * (height - 2 * pad);
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="predicted vs actual">
      <line x1={sx(min)} y1={sy(min)} x2={sx(max)} y2={sy(max)} stroke="#888" strokeDasharray="4 3" />
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.pred)} cy={sy(p.actual)} r={2.2} fill="#5b8def" opacity={0.5} />
      ))}
      <text x={width / 2} y={height - 6} fontSize="10" fill="#888" textAnchor="middle">predicted →</text>
      <text x={10} y={height / 2} fontSize="10" fill="#888" transform={`rotate(-90 10 ${height / 2})`} textAnchor="middle">actual →</text>
    </svg>
  );
}

export function Reliability({
  data,
  width = 280,
  height = 280,
}: {
  data: { pred: number; actual: number; n: number }[];
  width?: number;
  height?: number;
}) {
  const pad = 30;
  const sx = (v: number) => pad + v * (width - 2 * pad);
  const sy = (v: number) => height - pad - v * (height - 2 * pad);
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="calibration">
      <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="#bbb" strokeDasharray="4 3" />
      {data.map((d, i) => (
        <circle key={i} cx={sx(d.pred)} cy={sy(d.actual)} r={Math.max(3, Math.sqrt(d.n))} fill="#5b8def" opacity={0.7} />
      ))}
      <text x={pad} y={height - 8} fontSize="10" fill="#666">predicted →</text>
      <text x={6} y={pad} fontSize="10" fill="#666">actual ↑</text>
    </svg>
  );
}

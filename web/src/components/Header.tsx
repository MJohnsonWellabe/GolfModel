import type { Manifest } from "../types";

export function Header({ manifest }: { manifest: Manifest | null }) {
  return (
    <header className="header">
      <div className="banner">⚠ ACADEMIC EXERCISE — NOT BETTING ADVICE</div>
      <h1>GolfModel · Single-Round Score Over/Under Value</h1>
      {manifest ? (
        <div className="meta-grid">
          <div><span>Event</span><strong>{manifest.course_name} · R{manifest.round_num}</strong></div>
          <div><span>Par</span><strong>{manifest.par} ({manifest.course_base_to_par >= 0 ? "+" : ""}{manifest.course_base_to_par} base)</strong></div>
          <div><span>Field strength</span><strong>{manifest.field_strength}</strong></div>
          <div><span>Players</span><strong>{manifest.n_players}</strong></div>
          <div><span>Actionable bets</span><strong>{manifest.n_actionable} / {manifest.n_bets}</strong></div>
          <div>
            <span>Wave wind (eff. mph)</span>
            <strong>{Object.entries(manifest.wave_wind).map(([w, v]) => `${w}:${v}`).join("  ")}</strong>
          </div>
        </div>
      ) : (
        <p className="muted">Loading run manifest…</p>
      )}
    </header>
  );
}

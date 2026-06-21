import { useEffect, useState } from "react";
import { fetchJSON } from "./api";
import type { Backtest, Manifest, Predictions } from "./types";
import { Header } from "./components/Header";
import { PredictionsView } from "./components/Predictions";
import { GolferDetail } from "./components/GolferDetail";
import { BacktestView } from "./components/Backtest";

type Tab = "predictions" | "backtest";

export function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [predictions, setPredictions] = useState<Predictions | null>(null);
  const [backtest, setBacktest] = useState<Backtest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("predictions");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetchJSON<Manifest>("manifest.json").then(setManifest).catch((e) => setError(String(e)));
    fetchJSON<Predictions>("predictions.json").then(setPredictions).catch((e) => setError(String(e)));
    fetchJSON<Backtest>("backtest/summary.json").then(setBacktest).catch(() => void 0);
  }, []);

  return (
    <div className="app">
      <Header manifest={manifest} />
      {error && <div className="error">Could not load data: {error}. Run <code>make pipeline</code> first.</div>}

      <nav className="tabs">
        <button className={tab === "predictions" ? "active" : ""} onClick={() => setTab("predictions")}>
          Predictions
        </button>
        <button className={tab === "backtest" ? "active" : ""} onClick={() => setTab("backtest")}>
          Backtest{backtest?.test_year ? ` (${backtest.test_year})` : ""}
        </button>
      </nav>

      {tab === "predictions" && predictions && (
        <PredictionsView data={predictions} onSelect={(id) => setSelected(id)} />
      )}
      {tab === "backtest" && <BacktestView backtest={backtest} />}

      {selected && <GolferDetail playerId={selected} onClose={() => setSelected(null)} />}

      <footer>
        <p>{manifest?.disclaimer ?? "ACADEMIC EXERCISE — score prediction only."}</p>
        {manifest && <p className="muted">Generated {new Date(manifest.generated_at).toLocaleString()} · sources: {manifest.sources.join(", ")}</p>}
      </footer>
    </div>
  );
}

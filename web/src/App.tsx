import { useEffect, useState } from "react";
import { fetchJSON } from "./api";
import type { Backtest, Manifest, ValueBoard } from "./types";
import { Header } from "./components/Header";
import { ValueBoardView } from "./components/ValueBoard";
import { GolferDetail } from "./components/GolferDetail";
import { BacktestView } from "./components/Backtest";

type Tab = "board" | "backtest";

export function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [board, setBoard] = useState<ValueBoard | null>(null);
  const [backtest, setBacktest] = useState<Backtest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("board");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    fetchJSON<Manifest>("manifest.json").then(setManifest).catch((e) => setError(String(e)));
    fetchJSON<ValueBoard>("value_board.json").then(setBoard).catch((e) => setError(String(e)));
    fetchJSON<Backtest>("backtest/summary.json").then(setBacktest).catch(() => void 0);
  }, []);

  return (
    <div className="app">
      <Header manifest={manifest} />
      {error && <div className="error">Could not load data: {error}. Run <code>make pipeline</code> first.</div>}

      <nav className="tabs">
        <button className={tab === "board" ? "active" : ""} onClick={() => setTab("board")}>
          Value Board
        </button>
        <button className={tab === "backtest" ? "active" : ""} onClick={() => setTab("backtest")}>
          Backtest
        </button>
      </nav>

      {tab === "board" && board && (
        <ValueBoardView board={board} onSelect={(id) => setSelected(id)} />
      )}
      {tab === "backtest" && <BacktestView backtest={backtest} />}

      {selected && <GolferDetail playerId={selected} onClose={() => setSelected(null)} />}

      <footer>
        <p>{manifest?.disclaimer ?? "ACADEMIC EXERCISE — NOT BETTING ADVICE."}</p>
        {manifest && <p className="muted">Generated {new Date(manifest.generated_at).toLocaleString()} · sources: {manifest.sources.join(", ")}</p>}
      </footer>
    </div>
  );
}

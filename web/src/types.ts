export interface Manifest {
  schema: number;
  generated_at: string;
  disclaimer: string;
  event_id: string;
  course_name: string;
  round_num: number;
  par: number;
  course_base_to_par: number;
  field_strength: number;
  n_players: number;
  n_bets: number;
  n_actionable: number;
  wave_wind: Record<string, number>;
  model?: string;
  sources: string[];
}

export interface Bet {
  player_id: string;
  player_name: string;
  wave: string;
  has_line: boolean;
  line: number | null;
  side: "Over" | "Under" | "";
  price: number | null;
  model_prob: number | null;
  novig_prob: number | null;
  edge: number | null;
  ev_per_unit: number | null;
  kelly: number | null;
  e_score: number;
  p10: number;
  p90: number;
  n_eff: number;
  actionable: boolean;
}

export interface ValueBoard {
  schema: number;
  disclaimer: string;
  generated_at: string;
  event_id: string;
  course_name: string;
  round_num: number;
  bets: Bet[];
}

export interface Golfer {
  schema: number;
  player_id: string;
  player_name: string;
  wave: string;
  rating: {
    skill: number | null;
    skill_overall: number | null;
    n_eff: number;
    n_course: number;
    course_rounds_played: number;
  };
  expected: { e_score: number; p10: number; p50: number; p90: number; sd: number };
  line: Record<string, unknown> | null;
  bet: Bet | null;
  distribution: { counts: number[]; edges: number[] };
  recent_rounds: { date: string; course_id: string; round_num: number; to_par: number }[];
}

export interface Backtest {
  schema: number;
  n_predictions: number;
  date_range?: [string, string];
  prediction?: {
    rmse: number;
    mae: number;
    rmse_naive: number;
    interval_coverage_80: number;
    crps: number;
  };
  over_under?: {
    brier: number;
    "brier_baseline_0.5": number;
    log_loss: number;
    reliability: { pred: number; actual: number; n: number }[];
  };
  betting_synthetic?: { roi: number; hit_rate: number; n_bets: number; profit: number };
  bankroll_curve?: { date: string; bankroll: number }[];
  disclaimer?: string;
  note?: string;
}

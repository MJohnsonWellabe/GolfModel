export interface Manifest {
  schema: number;
  generated_at: string;
  disclaimer: string;
  model?: string;
  event_id: string;
  course_name: string;
  round_num: number;
  par: number;
  course_base_to_par: number;
  field_strength: number;
  n_players: number;
  wave_wind: Record<string, number>;
  sources: string[];
}

export interface Prediction {
  player_id: string;
  player_name: string;
  wave: string;
  e_score: number;
  e_to_par: number;
  p10: number;
  p90: number;
  sd: number;
  n_eff: number;
}

export interface Predictions {
  schema: number;
  disclaimer: string;
  generated_at: string;
  event_id: string;
  course_name: string;
  round_num: number;
  par: number;
  predictions: Prediction[];
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
  distribution: { counts: number[]; edges: number[] };
  recent_rounds: { date: string; course_id: string; round_num: number; to_par: number }[];
}

export interface Backtest {
  schema: number;
  test_year: number | null;
  n_predictions: number;
  n_rounds?: number;
  date_range?: [string, string];
  note?: string;
  headline?: {
    rmse: number;
    mae: number;
    rmse_naive: number;
    mae_naive: number;
    improvement_vs_naive_pct: number;
    interval_coverage_80: number;
    crps: number;
    mean_actual: number;
    mean_pred: number;
  };
  scatter?: { pred: number; actual: number }[];
  error_hist?: { counts: number[]; edges: number[] };
  by_round?: { round: number; n: number; rmse: number }[];
  by_event?: { event: string; date: string; n: number; rmse: number; rmse_naive: number }[];
  examples?: {
    best: { player: string; event: string; round: number; pred: number; actual: number }[];
    worst: { player: string; event: string; round: number; pred: number; actual: number }[];
  };
}

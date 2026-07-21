/**
 * Hand-authored Supabase database types for the FHE Prediction Arena schema
 * (supabase/migrations/20260612000000_prediction_arena.sql).
 *
 * Every Supabase client in this app is created as `SupabaseClient<Database>`,
 * so queries, inserts, and the `useAuth()` profile are all checked against
 * this single source of truth.
 *
 * After future schema changes, regenerate with:
 *   npx supabase gen types typescript --project-id <ref> --schema public > src/types/database.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type GameTier = "nightly" | "monthly" | "seasonal";
export type QuestionType = "boolean" | "single_choice" | "multi_choice" | "ranking";
// Native values of the game_status enum (see
// supabase/migrations/20260612000000_prediction_arena.sql). 'draft' =
// agent-proposed, awaiting analyst approval.
export type GameStatus = "draft" | "active" | "locked" | "resolved" | "skipped";

// ── Draft Night Challenge (dedicated MVP schema) ────────────────────────────
// supabase/migrations/20260614010000_draft_night.sql. Intentionally separate
// from the Prediction Arena tables above.
export type DnGameStatus = "draft" | "live" | "locked" | "resolved";
export type DnMiniGameKey =
  | "mock_lottery"
  | "guard_order"
  | "drafted_higher"
  | "first_round";
export type DnMiniGameType = "rank_order" | "single_pick" | "multi_select";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string | null;
          avatar_url: string | null;
          edge_points: number;
          analyst_badge: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          username?: string | null;
          avatar_url?: string | null;
          // edge_points / analyst_badge are server-managed and intentionally
          // omitted from Insert/Update; the column-grant hardening migration
          // enforces that at the DB layer.
        };
        Update: {
          username?: string | null;
          avatar_url?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      prediction_games: {
        Row: {
          id: string;
          title: string;
          description: string | null;
          tier: GameTier;
          question_type: QuestionType;
          options: Json;
          deadline: string;
          outcome: Json | null;
          status: GameStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          description?: string | null;
          tier: GameTier;
          question_type: QuestionType;
          options?: Json;
          deadline: string;
          outcome?: Json | null;
          status?: GameStatus;
          created_at?: string;
        };
        Update: {
          title?: string;
          description?: string | null;
          tier?: GameTier;
          question_type?: QuestionType;
          options?: Json;
          deadline?: string;
          outcome?: Json | null;
          status?: GameStatus;
        };
        Relationships: [];
      };
      user_predictions: {
        Row: {
          id: string;
          user_id: string;
          game_id: string;
          prediction_selection: Json;
          is_correct: boolean | null;
          points_awarded: number;
          submitted_at: string;
        };
        Insert: {
          user_id: string;
          game_id: string;
          prediction_selection: Json;
          // is_correct / points_awarded / submitted_at are server-managed
          // (submitted_at defaults to the database clock via now()).
        };
        Update: never; // predictions are immutable once submitted (no RLS update policy)
        Relationships: [
          {
            foreignKeyName: "user_predictions_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_predictions_game_id_fkey";
            columns: ["game_id"];
            referencedRelation: "prediction_games";
            referencedColumns: ["id"];
          },
        ];
      };
      dn_games: {
        Row: {
          id: string;
          slug: string;
          title: string;
          status: DnGameStatus;
          lock_at: string;
          resolved_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          title: string;
          status?: DnGameStatus;
          lock_at: string;
          resolved_at?: string | null;
          created_at?: string;
        };
        Update: {
          slug?: string;
          title?: string;
          status?: DnGameStatus;
          lock_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [];
      };
      dn_mini_games: {
        Row: {
          id: string;
          game_id: string;
          key: DnMiniGameKey;
          type: DnMiniGameType;
          sort: number;
          config: Json;
        };
        Insert: {
          id?: string;
          game_id: string;
          key: DnMiniGameKey;
          type: DnMiniGameType;
          sort?: number;
          config: Json;
        };
        Update: {
          sort?: number;
          config?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "dn_mini_games_game_id_fkey";
            columns: ["game_id"];
            referencedRelation: "dn_games";
            referencedColumns: ["id"];
          },
        ];
      };
      dn_predictions: {
        Row: {
          id: string;
          user_id: string;
          mini_game_id: string;
          payload: Json;
          score: number | null;
          called_it: boolean;
          locked: boolean;
          submitted_at: string;
        };
        Insert: {
          user_id: string;
          mini_game_id: string;
          payload: Json;
          locked?: boolean;
          // score is server-managed (the grader writes it via the service role).
        };
        // Users cannot update (no RLS update policy → immutable for them); only
        // the service-role grader writes `score` and `called_it` via the service role.
        Update: { score?: number | null; called_it?: boolean };
        Relationships: [
          {
            foreignKeyName: "dn_predictions_user_id_fkey";
            columns: ["user_id"];
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dn_predictions_mini_game_id_fkey";
            columns: ["mini_game_id"];
            referencedRelation: "dn_mini_games";
            referencedColumns: ["id"];
          },
        ];
      };
      dn_results: {
        Row: {
          id: string;
          game_id: string;
          picks: Json;
          resolved_at: string;
        };
        Insert: {
          id?: string;
          game_id: string;
          picks: Json;
          resolved_at?: string;
        };
        Update: {
          picks?: Json;
          resolved_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dn_results_game_id_fkey";
            columns: ["game_id"];
            referencedRelation: "dn_games";
            referencedColumns: ["id"];
          },
        ];
      };
      // ── NBA data pipeline (supabase/migrations/20260618000000_nba_pipeline.sql) ──
      // Public read-only for the app; all writes go through the service-role
      // ingest scripts (scripts/nba-data/), so Insert/Update are `never` here.
      nba_teams: {
        Row: {
          id: string;
          abbreviation: string;
          full_name: string | null;
          conference: string | null;
          division: string | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      nba_players: {
        Row: {
          id: string;
          full_name: string;
          norm_name: string;
          team: string | null;
          position: string | null;
          is_active: boolean;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      nba_player_game_logs: {
        Row: {
          game_id: string;
          player_id: string;
          game_date: string | null;
          season: number;
          season_type: string;
          team: string | null;
          min: number | null;
          pts: number | null;
          reb: number | null;
          oreb: number | null;
          dreb: number | null;
          ast: number | null;
          stl: number | null;
          blk: number | null;
          tov: number | null;
          fgm: number | null;
          fga: number | null;
          fg3m: number | null;
          fg3a: number | null;
          ftm: number | null;
          fta: number | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "nba_player_game_logs_player_id_fkey";
            columns: ["player_id"];
            referencedRelation: "nba_players";
            referencedColumns: ["id"];
          },
        ];
      };
      nba_contracts: {
        Row: {
          player_id: string | null;
          salary_player_name: string;
          norm_name: string;
          team: string | null;
          salary_current: number | null;
          salary_y2: number | null;
          salary_y3: number | null;
          salary_y4: number | null;
          salary_y5: number | null; // 2029-30 (migration 20260630000000)
          contract_note: string | null;
          free_agent_year: number | null;
          free_agent_status: string | null;
          is_two_way: boolean | null;
          salary_estimated: boolean; // any year even-split estimated
          salary_note: string | null;
          source: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "nba_contracts_player_id_fkey";
            columns: ["player_id"];
            referencedRelation: "nba_players";
            referencedColumns: ["id"];
          },
        ];
      };
      season_player_stats: {
        Row: {
          player_id: string;
          season: number;
          season_type: string;
          name: string;
          team: string | null;
          position: string | null;
          headshot_id: string | null;
          g: number | null;
          mpg: number | null;
          pts: number | null;
          fg3m: number | null;
          reb: number | null;
          ast: number | null;
          stl: number | null;
          blk: number | null;
          tov: number | null;
          fga: number | null;
          fta: number | null;
          fg_pct: number | null;
          ft_pct: number | null;
          consensus_rank: number | null;
          // Standard usage rate — needs TEAM totals (TeamMP/TeamFGA/TeamFTA/TeamTOV)
          // per season+season_type+team, computed by build-seasonal-values.ts for
          // every dataset (regular/playoffs/summer league, all seasons).
          usg_pct: number | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      season_player_values: {
        Row: {
          player_id: string;
          season: number;
          season_type: string;
          league_size: number;
          v_pts: number | null;
          v_fg3: number | null;
          v_reb: number | null;
          v_ast: number | null;
          v_stl: number | null;
          v_blk: number | null;
          v_fg: number | null;
          v_ft: number | null;
          v_to: number | null;
          value: number | null;
          minus1v: number | null;
          value_rank: number | null;
          // Totals-mode values (standardized against season totals, not per-game).
          v_pts_tot: number | null;
          v_fg3_tot: number | null;
          v_reb_tot: number | null;
          v_ast_tot: number | null;
          v_stl_tot: number | null;
          v_blk_tot: number | null;
          v_fg_tot: number | null;
          v_ft_tot: number | null;
          v_to_tot: number | null;
          value_tot: number | null;
          minus1v_tot: number | null;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "season_player_values_player_id_fkey";
            columns: ["player_id"];
            referencedRelation: "season_player_stats";
            referencedColumns: ["player_id"];
          },
        ];
      };
      // Enriched per-season roster (migration 20260630000000_nba_roster).
      // Fed by scripts/nba-data/roster_ingest.ts from data/nba-rosters/<season>.csv.
      // salary_yr1 = `season`; yr2..yr4 are the following seasons. Estimated years
      // (even-split of contract_total) flagged in salary_estimated/_years.
      nba_roster: {
        Row: {
          season: string;
          team: string;
          player_id: string | null;
          norm_name: string;
          full_name: string;
          jersey: string | null;
          position: string | null;
          height: string | null;
          weight: number | null;
          dob: string | null;
          age_at_ingest: number | null;
          years_of_service: string | null;
          draft_raw: string | null;
          draft_year: number | null;
          draft_pick: number | null;
          is_undrafted: boolean;
          nationality: string | null;
          birthplace: string | null;
          pre_draft: string | null;
          prior_team: string | null;
          contract_raw: string | null;
          contract_years: number | null;
          contract_total: number | null;
          contract_status: string | null;
          fa_year: number | null;
          fa_option_years: number;
          salary_yr1: number | null;
          salary_yr2: number | null;
          salary_yr3: number | null;
          salary_yr4: number | null;
          salary_estimated: boolean;
          salary_estimated_years: string | null;
          salary_qo_years: string | null;
          salary_source: string | null;
          is_incoming_rookie: boolean;
          is_sophomore: boolean;
          new_to_team: boolean;
          source: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "nba_roster_player_id_fkey";
            columns: ["player_id"];
            referencedRelation: "nba_players";
            referencedColumns: ["id"];
          },
        ];
      };
      // Per-player block-level value trends (migration 20260707000000_nba_player_trends).
      // Written by scripts/build-player-trends.ts (service role); payload is the full
      // PlayerTrendOut object — the exact shape /api/player-trends serves.
      nba_player_trends: {
        Row: {
          season: number;
          season_type: string;
          player_id: string;
          player_name: string;
          generated_at: string;
          payload: Json;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "nba_player_trends_player_id_fkey";
            columns: ["player_id"];
            referencedRelation: "nba_players";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      dn_leaderboard: {
        Row: {
          game_id: string;
          user_id: string;
          username: string | null;
          avatar_url: string | null;
          score: number;
          called_it_cards: number;
          rank: number;
          percentile: number;
        };
        Relationships: [];
      };
      dn_mini_leaderboard: {
        Row: {
          mini_game_id: string;
          mini_game_key: string;
          game_id: string;
          user_id: string;
          score: number;
          rank: number;
          total_players: number;
          tied_at_rank: number;
        };
        Relationships: [];
      };
      nba_season_averages: {
        Row: {
          player_id: string;
          season: number;
          season_type: string;
          gp: number;
          min: number | null;
          pts: number | null;
          reb: number | null;
          ast: number | null;
          stl: number | null;
          blk: number | null;
          tov: number | null;
          fg3m: number | null;
          fga: number | null;
          fta: number | null;
          fg_pct: number | null;
          ft_pct: number | null;
        };
        Relationships: [];
      };
      nba_free_agents: {
        Row: {
          player_id: string | null;
          player: string;
          team: string | null;
          free_agent_status: string | null;
          free_agent_year: number | null;
          salary_current: number | null;
        };
        Relationships: [];
      };
      // Season-explicit relabel of nba_contracts' wide salary columns, so
      // consumers never have to remember salary_y2 = 2026-27 (migration
      // 20260630000000_nba_roster).
      nba_contract_seasons: {
        Row: {
          player_id: string | null;
          player: string;
          team: string | null;
          salary_2025_26: number | null;
          salary_2026_27: number | null;
          salary_2027_28: number | null;
          salary_2028_29: number | null;
          salary_2029_30: number | null;
          contract_note: string | null;
          free_agent_year: number | null;
          free_agent_status: string | null;
          is_two_way: boolean | null;
          salary_estimated: boolean | null;
          salary_note: string | null;
        };
        Relationships: [];
      };
      nba_trade_candidates: {
        Row: {
          player_id: string | null;
          player: string;
          team: string | null;
          free_agent_status: string | null;
          free_agent_year: number | null;
          salary_current: number | null;
          fhe_signal: string;
          disclaimer: string;
        };
        Relationships: [];
      };
    };
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

// ── Convenience aliases used across the app ─────────────────────────────────
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];
export type PredictionGame = Database["public"]["Tables"]["prediction_games"]["Row"];
export type UserPrediction = Database["public"]["Tables"]["user_predictions"]["Row"];
export type UserPredictionInsert = Database["public"]["Tables"]["user_predictions"]["Insert"];

// ── Draft Night convenience aliases ─────────────────────────────────────────
export type DnGame = Database["public"]["Tables"]["dn_games"]["Row"];
export type DnMiniGame = Database["public"]["Tables"]["dn_mini_games"]["Row"];
export type DnPrediction = Database["public"]["Tables"]["dn_predictions"]["Row"];
export type DnPredictionInsert = Database["public"]["Tables"]["dn_predictions"]["Insert"];
export type DnResult = Database["public"]["Tables"]["dn_results"]["Row"];
export type DnLeaderboardRow = Database["public"]["Views"]["dn_leaderboard"]["Row"];
export type DnMiniLeaderboardRow = Database["public"]["Views"]["dn_mini_leaderboard"]["Row"] & {
  mini_game_key: DnMiniGameKey;
};

// ── NBA data pipeline convenience aliases ───────────────────────────────────
export type NbaTeam = Database["public"]["Tables"]["nba_teams"]["Row"];
export type NbaPlayer = Database["public"]["Tables"]["nba_players"]["Row"];
export type NbaPlayerGameLog = Database["public"]["Tables"]["nba_player_game_logs"]["Row"];
export type NbaContract = Database["public"]["Tables"]["nba_contracts"]["Row"];
export type NbaRoster = Database["public"]["Tables"]["nba_roster"]["Row"];
export type NbaPlayerTrends = Database["public"]["Tables"]["nba_player_trends"]["Row"];
export type NbaSeasonAverage = Database["public"]["Views"]["nba_season_averages"]["Row"];
export type NbaFreeAgent = Database["public"]["Views"]["nba_free_agents"]["Row"];
export type NbaContractSeasons = Database["public"]["Views"]["nba_contract_seasons"]["Row"];
export type NbaTradeCandidate = Database["public"]["Views"]["nba_trade_candidates"]["Row"];

// ── Seasonal rankings convenience aliases ───────────────────────────────────
export type SeasonPlayerStats = Database["public"]["Tables"]["season_player_stats"]["Row"];
export type SeasonPlayerValues = Database["public"]["Tables"]["season_player_values"]["Row"];

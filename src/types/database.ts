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
          contract_note: string | null;
          free_agent_year: number | null;
          free_agent_status: string | null;
          is_two_way: boolean | null;
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
      // Aggregated per-game season averages (materialized view).
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

// ── NBA data pipeline convenience aliases ───────────────────────────────────
export type NbaTeam = Database["public"]["Tables"]["nba_teams"]["Row"];
export type NbaPlayer = Database["public"]["Tables"]["nba_players"]["Row"];
export type NbaPlayerGameLog = Database["public"]["Tables"]["nba_player_game_logs"]["Row"];
export type NbaContract = Database["public"]["Tables"]["nba_contracts"]["Row"];
export type NbaSeasonAverage = Database["public"]["Views"]["nba_season_averages"]["Row"];
export type NbaFreeAgent = Database["public"]["Views"]["nba_free_agents"]["Row"];
export type NbaTradeCandidate = Database["public"]["Views"]["nba_trade_candidates"]["Row"];

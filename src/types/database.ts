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
    };
    Views: Record<string, never>;
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

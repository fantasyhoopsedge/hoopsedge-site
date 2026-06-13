/**
 * Canonical import path for Supabase database types.
 * The definitions live in ./database.ts (hand-authored against
 * supabase/migrations/20260612000000_prediction_arena.sql); this module
 * re-exports them so both `@/types/supabase` and `@/types/database` resolve
 * to the same single source of truth.
 */
export * from "./database";
export type { Database as default } from "./database";

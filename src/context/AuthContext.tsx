"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import type { Database, Profile } from "@/types/database";

type AuthContextValue = {
  /** Verified Supabase auth user, or null when signed out. */
  user: User | null;
  /** Row from public.profiles (typed straight off the Database schema). */
  profile: Profile | null;
  /** True until the initial session + profile fetch settles. */
  loading: boolean;
  /** Error message from the last auth operation, if any. */
  authError: string | null;
  /** Info/success message (e.g. "check your email"), separate from errors. */
  authMessage: string | null;
  /** Shared typed client for data fetches; null when env isn't configured. */
  supabase: SupabaseClient<Database> | null;
  /** OAuth sign-in. `next` is the same-origin path to return to (default /prediction-arena). */
  signInWithGoogle: (next?: string) => Promise<void>;
  /** Alias of signInWithGoogle. */
  loginWithGoogle: (next?: string) => Promise<void>;
  /** Email + password sign-in. */
  signInWithEmail: (email: string, password: string) => Promise<void>;
  /** Email + password sign-up (sends a confirmation email). `next` is where the
   * confirmation link returns the user (default /prediction-arena). */
  signUpWithEmail: (email: string, password: string, next?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-fetch the profile row (e.g. after points are awarded). */
  refreshProfile: () => Promise<void>;
  // ── Site-wide sign-up modal (rendered once at the root) ───────────────────
  /** True while the shared sign-up/log-in modal is open. */
  signUpModalOpen: boolean;
  /** Same-origin path to return to after OAuth/email-confirm sign-up. */
  signUpNext: string;
  /** Open the shared sign-up modal; `next` is where to land after auth. */
  openSignUp: (next?: string) => void;
  closeSignUp: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Null when NEXT_PUBLIC_SUPABASE_* env vars are missing — the arena then
  // renders the signed-out landing instead of crashing the route.
  const supabase = useMemo(() => {
    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [signUpModalOpen, setSignUpModalOpen] = useState(false);
  const [signUpNext, setSignUpNext] = useState("/prediction-arena");

  // Track auth state. onAuthStateChange fires INITIAL_SESSION on mount, so it
  // doubles as the initial load. Profile fetching happens in the effect below
  // (never await Supabase calls inside this callback — it can deadlock).
  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session: Session | null) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  // Fetch the public.profiles row whenever the signed-in user changes.
  useEffect(() => {
    if (!user || !supabase) return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();
      if (cancelled) return;
      if (error) {
        setAuthError(error.message);
        setProfile(null);
      } else {
        setProfile(data);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, user]);

  // Clean up OAuth redirect artifacts (?auth_error=…, ?code=…) from the URL
  // so users land on a pristine /prediction-arena after the callback.
  useEffect(() => {
    const url = new URL(window.location.href);
    const oauthError = url.searchParams.get("auth_error");
    if (oauthError) {
      setAuthError("Google sign-in didn't complete. Please try again.");
    }
    if (oauthError !== null || url.searchParams.has("code")) {
      url.searchParams.delete("auth_error");
      url.searchParams.delete("code");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    }
  }, []);

  const signInWithGoogle = useCallback(async (next: string = "/prediction-arena") => {
    setAuthError(null);
    setAuthMessage(null);
    if (!supabase) {
      setAuthError("Sign-in isn't available yet — Supabase environment variables are not configured.");
      return;
    }
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/prediction-arena";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
        queryParams: {
          access_type: "offline",
          prompt: "select_account",
        },
      },
    });
    if (error) setAuthError(error.message);
  }, [supabase]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      setAuthError(null);
      setAuthMessage(null);
      if (!supabase) {
        setAuthError("Sign-in isn't available yet — Supabase environment variables are not configured.");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setAuthError(error.message);
      // Success → onAuthStateChange fires and the dashboard renders.
    },
    [supabase],
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string, next: string = "/prediction-arena") => {
      setAuthError(null);
      setAuthMessage(null);
      if (!supabase) {
        setAuthError("Sign-up isn't available yet — Supabase environment variables are not configured.");
        return;
      }
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/prediction-arena";
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`,
        },
      });
      if (error) {
        setAuthError(error.message);
        return;
      }
      // With email confirmation on, there is no session until the user clicks
      // the link in their inbox.
      if (!data.session) {
        setAuthMessage("Almost there — check your email for a confirmation link, then sign in.");
      }
    },
    [supabase],
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    setAuthError(null);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAuthError(error.message);
    } else {
      setUser(null);
      setProfile(null);
    }
  }, [supabase]);

  const openSignUp = useCallback((next: string = "/prediction-arena") => {
    setAuthError(null);
    setAuthMessage(null);
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/prediction-arena";
    setSignUpNext(safeNext);
    setSignUpModalOpen(true);
  }, []);

  const closeSignUp = useCallback(() => setSignUpModalOpen(false), []);

  const refreshProfile = useCallback(async () => {
    if (!user || !supabase) return;
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    if (data) setProfile(data);
  }, [supabase, user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      authError,
      authMessage,
      supabase,
      signInWithGoogle,
      loginWithGoogle: signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      signOut,
      refreshProfile,
      signUpModalOpen,
      signUpNext,
      openSignUp,
      closeSignUp,
    }),
    [
      user,
      profile,
      loading,
      authError,
      authMessage,
      supabase,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      signOut,
      refreshProfile,
      signUpModalOpen,
      signUpNext,
      openSignUp,
      closeSignUp,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth() must be used inside <AuthProvider> — wrap the route segment's layout.");
  }
  return ctx;
}

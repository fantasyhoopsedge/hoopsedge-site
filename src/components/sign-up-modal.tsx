"use client";

import { useState } from "react";
import { useAuth } from "@/context/AuthContext";

/**
 * The single site-wide sign-up / log-in modal. Rendered once at the root (inside
 * AuthProvider) and opened from anywhere via useAuth().openSignUp(next). Wired to
 * real Supabase auth — Google OAuth plus email/password — and reuses the
 * .modal-* styles already defined in globals.css.
 */
export function SignUpModal() {
  const {
    signUpModalOpen,
    closeSignUp,
    signUpNext,
    user,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    authError,
    authMessage,
  } = useAuth();

  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  // Gated on !user so a successful sign-in dismisses it without a setState effect.
  if (!signUpModalOpen || user) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (mode === "signup") await signUpWithEmail(email, password, signUpNext);
    else await signInWithEmail(email, password);
    setBusy(false);
  };

  return (
    <div
      className="modal-overlay active"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeSignUp();
      }}
    >
      <div className="modal-box">
        <button className="modal-close" onClick={closeSignUp} aria-label="Close">✕</button>
        <div className="modal-title">{mode === "signup" ? "Get The Edge" : "Welcome back"}</div>
        <p className="modal-sub">
          {mode === "signup"
            ? "Free dynasty rankings, rookie boards, and the Prediction Arena."
            : "Log in to your Fantasy Hoops Edge account."}
        </p>

        <button type="button" className="modal-google" onClick={() => void signInWithGoogle(signUpNext)}>
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          {mode === "signup" ? "Sign up with Google" : "Continue with Google"}
        </button>

        <div className="modal-divider">
          <div className="modal-divider-line"></div>
          <span>or</span>
          <div className="modal-divider-line"></div>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <input
            type="email"
            required
            placeholder="Email address"
            className="modal-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder={mode === "signup" ? "Create password" : "Password"}
            className="modal-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" className="modal-submit" disabled={busy}>
            {busy ? "…" : mode === "signup" ? "Sign Up Free" : "Log In"}
          </button>
        </form>

        <button
          type="button"
          onClick={closeSignUp}
          style={{
            display: "block",
            margin: "12px auto 0",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            color: "var(--text-muted)",
          }}
        >
          Maybe later
        </button>

        {authError ? (
          <p style={{ color: "var(--red-severe)", fontSize: 13, marginTop: 12, textAlign: "center" }}>{authError}</p>
        ) : null}
        {authMessage ? (
          <p style={{ color: "var(--green-elite)", fontSize: 13, marginTop: 12, textAlign: "center" }}>{authMessage}</p>
        ) : null}

        <p className="modal-footer">
          {mode === "signup" ? (
            <>Already have an account?{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode("login"); }}>Log in</a>
            </>
          ) : (
            <>New to FHE?{" "}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode("signup"); }}>Sign up free</a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

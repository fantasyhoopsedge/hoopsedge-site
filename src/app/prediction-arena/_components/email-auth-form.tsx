"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "@/context/AuthContext";

/**
 * Email + password sign-in / sign-up, shown on the signed-out arena landing
 * alongside the Google button. Sign-up sends a confirmation email (handled by
 * the existing /auth/callback route); the user confirms, then signs in.
 */
export function EmailAuthForm() {
  const { signInWithEmail, signUpWithEmail, authError, authMessage } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await signUpWithEmail(email.trim(), password);
      } else {
        await signInWithEmail(email.trim(), password);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="pa-form" onSubmit={onSubmit}>
      <input
        className="pa-input"
        type="email"
        name="email"
        autoComplete="email"
        placeholder="you@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <input
        className="pa-input"
        type="password"
        name="password"
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        placeholder="Password"
        minLength={6}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button type="submit" className="pa-submit" disabled={submitting}>
        {submitting
          ? "Working…"
          : mode === "signup"
            ? "Create account"
            : "Sign in"}
      </button>

      <p className="pa-toggle">
        {mode === "signup" ? "Already have an account?" : "New to FHE?"}{" "}
        <button
          type="button"
          className="pa-link"
          onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
        >
          {mode === "signup" ? "Sign in" : "Create one"}
        </button>
      </p>

      {authMessage ? (
        <p className="pa-message" role="status">
          {authMessage}
        </p>
      ) : null}
      {authError ? (
        <p className="pa-error" role="alert">
          {authError}
        </p>
      ) : null}
    </form>
  );
}

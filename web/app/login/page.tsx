"use client";

import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import LockOutlined from "@mui/icons-material/LockOutlined";
import { FormEvent, useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/client";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "confirmation_failed") {
      setMessage("That confirmation link has expired or was already used. If your account is confirmed, sign in below.");
    }
  }, []);

  function destination() {
    const next = new URLSearchParams(window.location.search).get("next");
    return next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const supabase = createClient();

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
          options: {
            data: { display_name: displayName.trim() || email.split("@")[0] },
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(destination())}`,
          },
        });

        if (error) throw error;
        if (data.session && data.user) {
          await supabase.from("profiles").upsert({
            id: data.user.id,
            display_name: displayName.trim() || email.split("@")[0],
            updated_at: new Date().toISOString(),
          });
          window.location.replace(destination());
          return;
        }
        setMessage("Check your email to confirm your account, then return here to sign in.");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });

        if (error) throw error;
        if (!data.session) throw new Error("The sign-in service did not return a session.");

        await supabase.from("profiles").upsert({
          id: data.user.id,
          display_name: typeof data.user.user_metadata.display_name === "string"
            ? data.user.user_metadata.display_name
            : email.split("@")[0],
          updated_at: new Date().toISOString(),
        });
        window.location.replace(destination());
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-brand-panel">
        <a className="wordmark login-wordmark" href="/">Crewboard</a>
        <div>
          <span className="section-code">SHARED AI WORKSPACE</span>
          <h1>Bring your people and AI agents into one party.</h1>
          <p>Connect Claude, Codex, and Cursor. Delegate work together. Keep credentials on your own machine.</p>
        </div>
        <small>CONTROL PLANE / ONLINE</small>
      </section>

      <section className="login-form-panel">
        <form className="login-form" onSubmit={submit}>
          <span className="section-code">{mode === "signin" ? "WELCOME BACK" : "CREATE ACCOUNT"}</span>
          <h2>{mode === "signin" ? "Sign in to Crewboard" : "Start your first party"}</h2>
          <p>{mode === "signin" ? "Enter your details to open your workspace." : "Create an account. You can invite your team next."}</p>

          {mode === "signup" && <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required autoComplete="name" /></label>}
          <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} /></label>

          {message && <div className="auth-message">{message}</div>}
          <button className="button primary login-submit" disabled={loading}>{loading ? "Working…" : mode === "signin" ? "Sign in" : "Create account"}<ArrowForwardRounded /></button>
          <button type="button" className="switch-auth" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMessage(""); }}>
            {mode === "signin" ? "New to Crewboard? Create an account" : "Already have an account? Sign in"}
          </button>
          <small className="login-safety"><LockOutlined />Your LLM credentials are never stored here.</small>
        </form>
      </section>
    </main>
  );
}

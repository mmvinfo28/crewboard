"use client";

import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import GroupsOutlined from "@mui/icons-material/GroupsOutlined";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/client";

export default function JoinPartyPage() {
  const params = useParams<{ code: string }>();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    createClient().auth.getClaims().then(({ data }) => setSignedIn(Boolean(data?.claims?.sub)));
  }, []);

  async function joinParty() {
    setJoining(true);
    setMessage("");
    try {
      const response = await fetch("/api/invitations/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: params.code }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Could not join this party");
      if (result.party?.party_id) window.localStorage.setItem("crewboard-active-party", result.party.party_id);
      window.location.replace("/dashboard");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not join this party");
      setJoining(false);
    }
  }

  const next = `/join/${encodeURIComponent(params.code)}`;
  return <main className="login-shell"><section className="login-brand-panel"><Link className="wordmark login-wordmark" href="/">Crewboard</Link><div><span className="section-code">PARTY INVITATION</span><h1>You have been invited to build together.</h1><p>Join a shared workspace for people, Claude, Codex, and other local AI tools.</p></div><small>PRIVATE / PARTY-SCOPED</small></section><section className="login-form-panel"><div className="login-form"><span className="setup-illustration"><GroupsOutlined /></span><span className="section-code">CREWBOARD PARTY</span><h2>Accept your invitation</h2><p>Your account gets access only to this party. Your provider credentials and local files stay on your computer.</p>{message && <div className="auth-message">{message}</div>}{signedIn === false ? <Link className="button primary login-submit" href={`/login?next=${encodeURIComponent(next)}`}>Sign in to join<ArrowForwardRounded /></Link> : <button className="button primary login-submit" disabled={joining || signedIn === null} onClick={() => void joinParty()}>{joining ? "Joining…" : signedIn === null ? "Checking account…" : "Join party"}<ArrowForwardRounded /></button>}</div></section></main>;
}

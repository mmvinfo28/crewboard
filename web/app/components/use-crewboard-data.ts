"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Database } from "../../lib/supabase/database.types";
import { createClient } from "../../lib/supabase/client";

type Tables = Database["public"]["Tables"];
export type Party = Tables["parties"]["Row"] & { role: string };
export type AgentRow = Tables["agents"]["Row"];
export type TaskRow = Tables["tasks"]["Row"];
export type DeviceRow = Tables["devices"]["Row"];
export type UsageRow = Tables["usage_events"]["Row"];
export type ActivityRow = Tables["activity_events"]["Row"];
export type Member = Tables["party_members"]["Row"] & {
  displayName: string;
  avatarUrl: string | null;
};

const ACTIVE_PARTY_KEY = "crewboard-active-party";

export function useCrewboardData() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("Member");
  const [parties, setParties] = useState<Party[]>([]);
  const [activePartyId, setActivePartyId] = useState("");
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [usageEvents, setUsageEvents] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const activeParty = parties.find((party) => party.id === activePartyId) ?? null;

  const loadParties = useCallback(async (preferredPartyId?: string) => {
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    const currentUserId = claimsData?.claims?.sub;
    if (claimsError || !currentUserId) return;
    setUserId(currentUserId);

    const [{ data: authData }, { data: profile }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("profiles").select("display_name").eq("id", currentUserId).maybeSingle(),
    ]);
    const authUser = authData.user;
    const fallback = typeof authUser?.user_metadata.display_name === "string"
      ? authUser.user_metadata.display_name
      : authUser?.email?.split("@")[0] ?? "Member";
    setEmail(authUser?.email ?? "");
    setDisplayName(profile?.display_name || fallback);

    const { data: memberships, error: membershipError } = await supabase
      .from("party_members")
      .select("party_id, role")
      .eq("user_id", currentUserId);
    if (membershipError) throw membershipError;
    const ids = memberships?.map((membership) => membership.party_id) ?? [];
    if (!ids.length) {
      setParties([]);
      setActivePartyId("");
      setLoading(false);
      return;
    }

    const { data: partyRows, error: partyError } = await supabase
      .from("parties")
      .select("id, name, slug, created_by, created_at, updated_at")
      .in("id", ids)
      .order("updated_at", { ascending: false });
    if (partyError) throw partyError;
    const roleByParty = new Map(memberships?.map((membership) => [membership.party_id, membership.role]));
    const nextParties = (partyRows ?? []).map((party) => ({ ...party, role: roleByParty.get(party.id) ?? "member" }));
    setParties(nextParties);

    const saved = preferredPartyId || window.localStorage.getItem(ACTIVE_PARTY_KEY) || "";
    const nextId = nextParties.some((party) => party.id === saved) ? saved : nextParties[0]?.id ?? "";
    setActivePartyId(nextId);
    if (nextId) window.localStorage.setItem(ACTIVE_PARTY_KEY, nextId);
  }, [supabase]);

  const loadPartyData = useCallback(async (partyId: string) => {
    if (!partyId) {
      setAgents([]); setTasks([]); setDevices([]); setMembers([]); setActivity([]); setUsageEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const [agentResult, taskResult, deviceResult, memberResult, activityResult, usageResult] = await Promise.all([
      supabase.from("agents").select("*").eq("party_id", partyId).order("created_at"),
      supabase.from("tasks").select("*").eq("party_id", partyId).order("created_at", { ascending: false }).limit(200),
      supabase.from("devices").select("*").eq("party_id", partyId).order("created_at"),
      supabase.from("party_members").select("*").eq("party_id", partyId).order("joined_at"),
      supabase.from("activity_events").select("*").eq("party_id", partyId).order("created_at", { ascending: false }).limit(100),
      supabase.from("usage_events").select("*").eq("party_id", partyId).order("created_at", { ascending: false }).limit(100),
    ]);
    const firstError = [agentResult.error, taskResult.error, deviceResult.error, memberResult.error, activityResult.error, usageResult.error].find(Boolean);
    if (firstError) {
      setError(firstError.message);
      setLoading(false);
      return;
    }
    const memberRows = memberResult.data ?? [];
    const memberIds = memberRows.map((member) => member.user_id);
    const { data: profiles } = memberIds.length
      ? await supabase.from("profiles").select("id, display_name, avatar_url").in("id", memberIds)
      : { data: [] };
    const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    setAgents(agentResult.data ?? []);
    setTasks(taskResult.data ?? []);
    setDevices(deviceResult.data ?? []);
    setMembers(memberRows.map((member) => ({
      ...member,
      displayName: profileById.get(member.user_id)?.display_name ?? "Crewboard member",
      avatarUrl: profileById.get(member.user_id)?.avatar_url ?? null,
    })));
    setActivity(activityResult.data ?? []);
    setUsageEvents(usageResult.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadParties().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not load your parties");
      setLoading(false);
    });
  }, [loadParties]);

  useEffect(() => {
    void loadPartyData(activePartyId);
    if (!activePartyId) return;
    const mergeRow = <T extends { id: string }>(rows: T[], row: T) => rows.some((item) => item.id === row.id)
      ? rows.map((item) => item.id === row.id ? row : item)
      : [row, ...rows];
    const channel = supabase.channel(`party-ui:${activePartyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "agents", filter: `party_id=eq.${activePartyId}` }, (payload) => {
        if (payload.eventType === "DELETE") setAgents((rows) => rows.filter((row) => row.id !== (payload.old as { id?: string }).id));
        else setAgents((rows) => mergeRow(rows, payload.new as AgentRow));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `party_id=eq.${activePartyId}` }, (payload) => {
        if (payload.eventType === "DELETE") setTasks((rows) => rows.filter((row) => row.id !== (payload.old as { id?: string }).id));
        else setTasks((rows) => mergeRow(rows, payload.new as TaskRow));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_events", filter: `party_id=eq.${activePartyId}` }, (payload) => {
        setActivity((rows) => [payload.new as ActivityRow, ...rows].slice(0, 100));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "usage_events", filter: `party_id=eq.${activePartyId}` }, (payload) => {
        setUsageEvents((rows) => [payload.new as UsageRow, ...rows].slice(0, 100));
      })
      .subscribe((status) => setRealtimeConnected(status === "SUBSCRIBED"));
    return () => { setRealtimeConnected(false); void supabase.removeChannel(channel); };
  }, [activePartyId, loadPartyData, supabase]);

  function selectParty(partyId: string) {
    setActivePartyId(partyId);
    window.localStorage.setItem(ACTIVE_PARTY_KEY, partyId);
  }

  async function createParty(name: string) {
    const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "party";
    const slug = `${base}-${crypto.randomUUID().slice(0, 8)}`;
    const { data, error: createError } = await supabase.rpc("create_party", { party_name: name.trim(), party_slug: slug });
    if (createError) throw createError;
    await loadParties(data);
    return data;
  }

  async function addTask(title: string, assignedAgentId?: string) {
    if (!activePartyId || !userId) throw new Error("Create or select a party first");
    const { error: taskError } = await supabase.from("tasks").insert({
      party_id: activePartyId,
      created_by: userId,
      title: title.trim(),
      assigned_agent_id: assignedAgentId || null,
      status: "queued",
    });
    if (taskError) throw taskError;
    await loadPartyData(activePartyId);
  }

  async function toggleAgent(agent: AgentRow) {
    if (agent.status === "offline") return;
    const nextStatus = agent.status === "paused" ? "ready" : "paused";
    const { error: updateError } = await supabase.from("agents").update({ status: nextStatus }).eq("id", agent.id);
    if (updateError) throw updateError;
    await loadPartyData(activePartyId);
  }

  return {
    userId, email, displayName, setDisplayName, parties, activeParty, activePartyId, selectParty,
    agents, tasks, devices, members, activity, usageEvents, loading, error, realtimeConnected,
    createParty, addTask, toggleAgent, refresh: () => loadPartyData(activePartyId),
  };
}

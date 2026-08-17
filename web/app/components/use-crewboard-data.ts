"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Database } from "../../lib/supabase/database.types";
import { createClient } from "../../lib/supabase/client";

type Tables = Database["public"]["Tables"];
export type Party = Tables["parties"]["Row"] & { role: string };
export type AgentRow = Tables["agents"]["Row"];
export type TaskRow = Tables["tasks"]["Row"];
export type TaskRunRow = Tables["task_runs"]["Row"];
export type TaskProgressRow = Tables["task_progress_events"]["Row"];
export type DeviceRow = Tables["devices"]["Row"];
export type DeviceSessionRow = Tables["device_sessions"]["Row"];
export type ProjectRow = Tables["projects"]["Row"];
export type DeviceFolderRow = Tables["device_folders"]["Row"];
export type RepositorySetupRow = Tables["repository_setup_requests"]["Row"];
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
  const [taskRuns, setTaskRuns] = useState<TaskRunRow[]>([]);
  const [taskProgress, setTaskProgress] = useState<TaskProgressRow[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [deviceSessions, setDeviceSessions] = useState<DeviceSessionRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [deviceFolders, setDeviceFolders] = useState<DeviceFolderRow[]>([]);
  const [repositorySetups, setRepositorySetups] = useState<RepositorySetupRow[]>([]);
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
      setAgents([]); setTasks([]); setTaskRuns([]); setTaskProgress([]); setDevices([]); setDeviceSessions([]); setProjects([]); setDeviceFolders([]); setRepositorySetups([]); setMembers([]); setActivity([]); setUsageEvents([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const [agentResult, taskResult, runResult, progressResult, deviceResult, sessionResult, projectResult, folderResult, setupResult, memberResult, activityResult, usageResult] = await Promise.all([
      supabase.from("agents").select("*").eq("party_id", partyId).order("created_at"),
      supabase.from("tasks").select("*").eq("party_id", partyId).order("created_at", { ascending: false }).limit(200),
      supabase.from("task_runs").select("*").eq("party_id", partyId).order("created_at", { ascending: false }).limit(200),
      supabase.from("task_progress_events").select("*").eq("party_id", partyId).order("created_at", { ascending: false }).limit(400),
      supabase.from("devices").select("*").eq("party_id", partyId).order("created_at"),
      supabase.from("device_sessions").select("*").eq("party_id", partyId).order("created_at", { ascending: false }),
      supabase.from("projects").select("*").eq("party_id", partyId).order("created_at", { ascending: false }),
      supabase.from("device_folders").select("*").eq("party_id", partyId).order("created_at", { ascending: false }),
      supabase.from("repository_setup_requests").select("*").eq("party_id", partyId).order("created_at", { ascending: false }).limit(20),
      supabase.from("party_members").select("*").eq("party_id", partyId).order("joined_at"),
      supabase.from("activity_events").select("*").eq("party_id", partyId).order("created_at", { ascending: false }).limit(100),
      supabase.from("usage_events").select("*").eq("party_id", partyId).order("created_at", { ascending: false }).limit(100),
    ]);
    const firstError = [agentResult.error, taskResult.error, runResult.error, progressResult.error, deviceResult.error, sessionResult.error, projectResult.error, folderResult.error, setupResult.error, memberResult.error, activityResult.error, usageResult.error].find(Boolean);
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
    setTaskRuns(runResult.data ?? []);
    setTaskProgress(progressResult.data ?? []);
    setDevices(deviceResult.data ?? []);
    setDeviceSessions(sessionResult.data ?? []);
    setProjects(projectResult.data ?? []);
    setDeviceFolders(folderResult.data ?? []);
    setRepositorySetups(setupResult.data ?? []);
    setMembers(memberRows.map((member) => ({
      ...member,
      displayName: profileById.get(member.user_id)?.display_name ?? "Crewboard member",
      avatarUrl: profileById.get(member.user_id)?.avatar_url ?? null,
    })));
    setActivity(activityResult.data ?? []);
    setUsageEvents(usageResult.data ?? []);
    setLoading(false);
  }, [supabase]);

  const refreshDevices = useCallback(async () => {
    if (!activePartyId) return [] as DeviceRow[];
    const { data, error: deviceError } = await supabase
      .from("devices")
      .select("*")
      .eq("party_id", activePartyId)
      .order("created_at");
    if (deviceError) throw deviceError;
    const rows = data ?? [];
    setDevices(rows);
    return rows;
  }, [activePartyId, supabase]);

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
      .on("postgres_changes", { event: "*", schema: "public", table: "task_runs", filter: `party_id=eq.${activePartyId}` }, (payload) => {
        if (payload.eventType === "DELETE") setTaskRuns((rows) => rows.filter((row) => row.id !== (payload.old as { id?: string }).id));
        else setTaskRuns((rows) => mergeRow(rows, payload.new as TaskRunRow));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "task_progress_events", filter: `party_id=eq.${activePartyId}` }, (payload) => {
        setTaskProgress((rows) => [payload.new as TaskProgressRow, ...rows].slice(0, 400));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `party_id=eq.${activePartyId}` }, (payload) => {
        if (payload.eventType === "DELETE") setProjects((rows) => rows.filter((row) => row.id !== (payload.old as { id?: string }).id));
        else setProjects((rows) => mergeRow(rows, payload.new as ProjectRow));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "device_folders", filter: `party_id=eq.${activePartyId}` }, (payload) => {
        if (payload.eventType === "DELETE") setDeviceFolders((rows) => rows.filter((row) => row.id !== (payload.old as { id?: string }).id));
        else setDeviceFolders((rows) => mergeRow(rows, payload.new as DeviceFolderRow));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "repository_setup_requests", filter: `party_id=eq.${activePartyId}` }, (payload) => {
        if (payload.eventType === "DELETE") setRepositorySetups((rows) => rows.filter((row) => row.id !== (payload.old as { id?: string }).id));
        else setRepositorySetups((rows) => mergeRow(rows, payload.new as RepositorySetupRow));
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

  useEffect(() => {
    if (!activePartyId) return;
    const refresh = () => { if (document.visibilityState === "visible") void refreshDevices().catch(() => {}); };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", refresh); };
  }, [activePartyId, refreshDevices]);

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

  async function addTask(input: { title: string; description?: string; assignedAgentId?: string; projectId?: string; priority?: string; autoSplit?: boolean; splitAgentIds?: string[] }) {
    if (!activePartyId || !userId) throw new Error("Create or select a party first");
    const { error: taskError } = await supabase.rpc("create_crew_task", {
      p_party_id: activePartyId,
      p_title: input.title.trim(),
      p_description: input.description?.trim() || "",
      p_assigned_agent_id: input.assignedAgentId || undefined,
      p_project_id: input.projectId || undefined,
      p_priority: input.priority || "medium",
      p_auto_split: Boolean(input.autoSplit),
      p_split_agent_ids: input.splitAgentIds || [],
    });
    if (taskError) throw taskError;
    await loadPartyData(activePartyId);
  }

  async function createAgent(input: { deviceId: string; name: string; provider: string; model: string; instructions?: string; contextWindowTokens?: number | null }) {
    const { data, error: agentError } = await supabase.rpc("create_named_agent", {
      p_device_id: input.deviceId,
      p_name: input.name.trim(),
      p_provider: input.provider,
      p_model: input.model.trim(),
      p_instructions: input.instructions?.trim() || "",
      p_context_window_tokens: input.contextWindowTokens ?? undefined,
    });
    if (agentError) throw agentError;
    await loadPartyData(activePartyId);
    return data;
  }

  async function requestRepositorySetup(input: { name: string; deviceId: string; sourceType: "local" | "github"; repositoryUrl?: string }) {
    if (!activePartyId || !userId) throw new Error("Create or select a party first");
    const { data, error: setupError } = await supabase.from("repository_setup_requests").insert({
      party_id: activePartyId,
      device_id: input.deviceId,
      requested_by: userId,
      name: input.name.trim(),
      source_type: input.sourceType,
      repository_url: input.sourceType === "github" ? input.repositoryUrl?.trim() || null : null,
    }).select().single();
    if (setupError) {
      if (setupError.code === "23505") throw new Error("That computer already has a folder picker waiting for you");
      throw setupError;
    }
    setRepositorySetups((rows) => [data, ...rows]);
    return data;
  }

  async function resumeTask(taskId: string) {
    const { error: resumeError } = await supabase.rpc("resume_interrupted_task", { p_task_id: taskId });
    if (resumeError) throw resumeError;
    await loadPartyData(activePartyId);
  }

  async function retryTask(taskId: string) {
    const { error: retryError } = await supabase.rpc("retry_failed_task", { p_task_id: taskId });
    if (retryError) throw retryError;
    await loadPartyData(activePartyId);
  }

  async function toggleAgent(agent: AgentRow) {
    if (agent.status === "offline") return;
    const nextStatus = agent.status === "paused" ? "ready" : "paused";
    const { error: updateError } = await supabase.from("agents").update({ status: nextStatus }).eq("id", agent.id);
    if (updateError) throw updateError;
    await loadPartyData(activePartyId);
  }

  async function revokeDeviceSession(sessionId: string) {
    const response = await fetch("/api/connector/session/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error?.message ?? "Could not disconnect this device");
    await loadPartyData(activePartyId);
  }

  return {
    userId, email, displayName, setDisplayName, parties, activeParty, activePartyId, selectParty,
    agents, tasks, taskRuns, taskProgress, devices, deviceSessions, projects, deviceFolders, repositorySetups, members, activity, usageEvents, loading, error, realtimeConnected,
    createParty, createAgent, addTask, requestRepositorySetup, resumeTask, retryTask, toggleAgent, revokeDeviceSession, refreshDevices, refresh: () => loadPartyData(activePartyId),
  };
}

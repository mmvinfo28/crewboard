import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import path from "node:path";
import { rpc, rotateToken } from "./api.js";
import { readCodexAccountUsage } from "./codex-usage.js";
import { saveConfig } from "./config.js";
import { cloneGitHubRepository, pathFingerprint, pickRepositoryFolder } from "./folder-picker.js";
import { parseSplitPlan, runAgent } from "./runner.js";

const HEARTBEAT_MS = 25_000;
const FALLBACK_POLL_MS = 60_000;
const PROVIDER_USAGE_REFRESH_MS = 5 * 60_000;

export class Connector {
  constructor(config, detectedAgents, options) {
    this.config = config;
    this.detectedAgents = detectedAgents;
    this.options = options;
    this.running = false;
    this.claiming = false;
    this.settingUpRepository = false;
    this.token = null;
    this.registeredAgents = [];
    this.providerUsageUpdatedAt = 0;
    this.providerUsageSyncing = false;
  }

  async refreshToken() {
    const token = await rotateToken(this.config, this.config.connectorVersion);
    this.config.refreshToken = token.refreshToken;
    this.config.device = { id: token.identity.deviceId, partyId: token.identity.partyId, ownerId: token.identity.ownerId };
    this.config.session = { id: token.identity.sessionId };
    await saveConfig(this.config);
    this.token = { ...token, expiresAt: Date.now() + token.expiresIn * 1000 };
    if (this.realtime) await this.realtime.setAuth(token.accessToken);
    return this.token;
  }

  async currentToken() {
    if (!this.token || Date.now() > this.token.expiresAt - 60_000) return this.refreshToken();
    return this.token;
  }

  async call(name, body) {
    try { return await rpc(await this.currentToken(), name, body); }
    catch (error) {
      if (error.status === 401) { await this.refreshToken(); return rpc(this.token, name, body); }
      throw error;
    }
  }

  async registerAgents() {
    const rows = await this.call("connector_register_agents", {
      p_device_id: this.config.device.id,
      p_agents: this.detectedAgents.map(({ provider, name, model, capabilities }) => ({ provider, name, model, capabilities })),
    });
    this.registeredAgents = rows.map((row) => ({ ...row, local: this.detectedAgents.find((agent) => agent.provider === row.provider) }));
    return this.registeredAgents;
  }

  async heartbeat(runId = null) {
    return this.call("connector_heartbeat", {
      p_device_id: this.config.device.id,
      p_run_id: runId,
      p_connector_version: this.config.connectorVersion,
      p_lease_seconds: 90,
    });
  }

  async syncProviderUsage(force = false) {
    if (this.providerUsageSyncing) return;
    if (!force && Date.now() - this.providerUsageUpdatedAt < PROVIDER_USAGE_REFRESH_MS) return;
    const codex = this.detectedAgents.find((agent) => agent.provider === "codex");
    if (!codex) return;
    this.providerUsageSyncing = true;
    try {
      const usage = await readCodexAccountUsage(codex);
      if (!usage?.primary) return;
      await this.call("connector_record_provider_usage", {
        p_party_id: this.config.device.partyId,
        p_device_id: this.config.device.id,
        p_provider: "codex",
        p_plan_type: usage.planType,
        p_primary_used_percent: usage.primary.usedPercent,
        p_primary_window_minutes: usage.primary.windowMinutes,
        p_primary_resets_at: usage.primary.resetsAt ? new Date(usage.primary.resetsAt * 1000).toISOString() : null,
        p_secondary_used_percent: usage.secondary?.usedPercent ?? null,
        p_secondary_window_minutes: usage.secondary?.windowMinutes ?? null,
        p_secondary_resets_at: usage.secondary?.resetsAt ? new Date(usage.secondary.resetsAt * 1000).toISOString() : null,
        p_lifetime_tokens: usage.lifetimeTokens,
        p_daily_tokens: usage.dailyTokens,
      });
      this.providerUsageUpdatedAt = Date.now();
    } catch (error) {
      console.error(`Could not read Codex account limits: ${error.message}`);
    } finally {
      this.providerUsageUpdatedAt = Date.now();
      this.providerUsageSyncing = false;
    }
  }

  async claimTasks() {
    if (this.claiming || !this.running) return;
    this.claiming = true;
    try {
      for (const agent of this.registeredAgents) {
        if (agent.status === "paused" || !agent.local) continue;
        const rows = await this.call("claim_next_task", {
          p_device_id: this.config.device.id,
          p_agent_id: agent.agent_id,
          p_capabilities: agent.capabilities,
          p_idempotency_key: `${agent.agent_id}:${crypto.randomUUID()}`,
          p_lease_seconds: 90,
        });
        if (rows?.[0]) await this.execute(agent, rows[0]);
      }
    } finally { this.claiming = false; }
  }

  async claimRepositorySetup() {
    if (this.settingUpRepository || !this.running) return;
    this.settingUpRepository = true;
    let request = null;
    try {
      const rows = await this.call("connector_claim_repository_setup", {
        p_device_id: this.config.device.id,
      });
      request = rows?.[0];
      if (!request) return;

      const isGitHub = request.source_type === "github";
      console.log(isGitHub
        ? `\nCrewboard is cloning “${request.name}” from GitHub.`
        : `\nCrewboard wants to add “${request.name}”. Choose its folder on this computer.`);
      const folderPath = isGitHub
        ? await cloneGitHubRepository(request.repository_url, request.request_id)
        : await pickRepositoryFolder();
      if (!folderPath) throw new Error("Folder selection was cancelled");

      this.config.pendingRepositoryPaths = {
        ...(this.config.pendingRepositoryPaths || {}),
        [request.request_id]: folderPath,
      };
      await saveConfig(this.config);

      const projectId = await this.call("connector_complete_repository_setup", {
        p_device_id: this.config.device.id,
        p_request_id: request.request_id,
        p_folder_label: path.basename(folderPath),
        p_path_fingerprint: pathFingerprint(this.config.device.id, folderPath),
      });
      this.config.projectPaths = {
        ...(this.config.projectPaths || {}),
        [projectId]: folderPath,
      };
      delete this.config.pendingRepositoryPaths[request.request_id];
      await saveConfig(this.config);
      console.log(`Repository ready: ${request.name} → ${folderPath}`);
    } catch (error) {
      if (request) {
        await this.call("connector_fail_repository_setup", {
          p_device_id: this.config.device.id,
          p_request_id: request.request_id,
          p_error_message: error.message,
        }).catch(() => {});
      }
      if (request) console.error(`Could not add repository: ${error.message}`);
    } finally {
      this.settingUpRepository = false;
    }
  }

  async sync() {
    await this.registerAgents();
    await this.syncProviderUsage();
    await this.claimRepositorySetup();
    await this.claimTasks();
  }

  async execute(agent, task) {
    console.log(`\n[${agent.name}] ${task.title}`);
    const startedAt = Date.now();
    const heartbeat = setInterval(() => { void this.heartbeat(task.run_id).catch((error) => console.error(`Heartbeat failed: ${error.message}`)); }, HEARTBEAT_MS);
    let progressQueue = Promise.resolve();
    let lastProgressAt = 0;
    let lastProgressMessage = "";
    const reportProgress = ({ kind = "update", message }) => {
      const cleanMessage = `${message || ""}`.replace(/\s+/g, " ").trim().slice(0, 500);
      if (!cleanMessage || cleanMessage === lastProgressMessage || Date.now() - lastProgressAt < 1500) return;
      lastProgressAt = Date.now();
      lastProgressMessage = cleanMessage;
      progressQueue = progressQueue.then(() => this.call("connector_append_task_progress", {
        p_device_id: this.config.device.id,
        p_run_id: task.run_id,
        p_kind: kind,
        p_message: cleanMessage,
        p_metadata: {},
      })).catch((error) => console.error(`Progress update failed: ${error.message}`));
    };
    try {
      const projectWorkspace = task.project_id ? this.config.projectPaths?.[task.project_id] : null;
      if (task.project_id && !projectWorkspace) throw new Error("This repository is not linked on this computer");
      reportProgress({ kind: "status", message: task.task_kind === "planner" ? "Coordinator is planning the split" : `${agent.name} started the task` });
      const result = await runAgent(agent, task, {
        ...this.options,
        workspace: projectWorkspace || this.options.workspace,
        allowWrites: task.task_kind === "planner" ? false : task.project_id ? true : this.options.allowWrites,
        onProgress: reportProgress,
      });
      const text = (result.text || "").trim().slice(-4000);
      const success = result.code === 0;
      await progressQueue;
      if (success && task.task_kind === "planner") {
        const splitItems = parseSplitPlan(result.text);
        await this.call("connector_create_task_split", {
          p_device_id: this.config.device.id,
          p_run_id: task.run_id,
          p_items: splitItems,
          p_result_summary: `Split into ${splitItems.length} tasks`,
        });
      } else {
        await this.call("complete_task_run", {
          p_device_id: this.config.device.id,
          p_run_id: task.run_id,
          p_status: success ? "completed" : "failed",
          p_result_summary: text || (success ? "Task completed" : "Agent returned no output"),
          p_error_code: success ? null : `agent_exit_${result.code ?? "unknown"}`,
        });
      }
      await this.call("connector_record_usage", {
        p_device_id: this.config.device.id,
        p_agent_id: agent.agent_id,
        p_task_id: task.task_id,
        p_provider: agent.provider,
        p_model: agent.model,
        p_duration_ms: Date.now() - startedAt,
        p_input_tokens: result.usage?.inputTokens || 0,
        p_output_tokens: result.usage?.outputTokens || 0,
        p_cached_input_tokens: result.usage?.cachedInputTokens || 0,
        p_cost_usd: result.usage?.costUsd || 0,
      });
      if (agent.provider === "codex") void this.syncProviderUsage(true);
      console.log(success ? `${task.task_kind === "planner" ? "Split created" : "Completed"} in ${Math.round((Date.now() - startedAt) / 1000)}s` : `Failed: ${text.slice(0, 240)}`);
    } catch (error) {
      await this.call("complete_task_run", {
        p_device_id: this.config.device.id,
        p_run_id: task.run_id,
        p_status: "failed",
        p_result_summary: error.message.slice(0, 4000),
        p_error_code: "connector_error",
      }).catch(() => {});
      console.error(`Task failed: ${error.message}`);
    } finally { clearInterval(heartbeat); }
  }

  async start() {
    this.running = true;
    const token = await this.refreshToken();
    await this.registerAgents();
    await this.heartbeat();
    await this.syncProviderUsage(true);
    console.log(`Connected device: ${this.config.device.id}`);
    console.log(`Agents online: ${this.registeredAgents.map((agent) => agent.name).join(", ") || "none"}`);
    console.log(`Workspace: ${this.options.workspace}`);
    console.log(this.options.allowWrites ? "File edits are enabled." : "Read-only mode. Use --allow-writes to let agents edit files.");
    console.log("Waiting for tasks. Press Ctrl+C to stop.\n");

    const supabase = createClient(token.supabase.url, token.supabase.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
    this.realtime = supabase.realtime;
    await this.realtime.setAuth(token.accessToken);
    this.channel = supabase.channel(token.supabase.wakeupTopic, { config: { private: true } })
      .on("broadcast", { event: "sync" }, () => { void this.sync(); })
      .subscribe((status) => { if (status === "SUBSCRIBED") void this.sync(); });
    this.poll = setInterval(() => { void this.sync(); }, FALLBACK_POLL_MS);
    this.deviceHeartbeat = setInterval(() => { void this.heartbeat().catch((error) => console.error(`Device heartbeat failed: ${error.message}`)); }, HEARTBEAT_MS);

    await new Promise((resolve) => {
      const stop = () => { this.running = false; resolve(); };
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
    });
    clearInterval(this.poll); clearInterval(this.deviceHeartbeat);
    if (this.channel) await supabase.removeChannel(this.channel);
  }
}

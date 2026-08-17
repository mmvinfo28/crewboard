import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import path from "node:path";
import { rpc, rotateToken } from "./api.js";
import { saveConfig } from "./config.js";
import { pathFingerprint, pickRepositoryFolder } from "./folder-picker.js";
import { runAgent } from "./runner.js";

const HEARTBEAT_MS = 25_000;
const FALLBACK_POLL_MS = 60_000;

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

      console.log(`\nCrewboard wants to add “${request.name}”. Choose its folder on this computer.`);
      const folderPath = await pickRepositoryFolder();
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
    await this.claimRepositorySetup();
    await this.claimTasks();
  }

  async execute(agent, task) {
    console.log(`\n[${agent.name}] ${task.title}`);
    const startedAt = Date.now();
    const heartbeat = setInterval(() => { void this.heartbeat(task.run_id).catch((error) => console.error(`Heartbeat failed: ${error.message}`)); }, HEARTBEAT_MS);
    try {
      const projectWorkspace = task.project_id ? this.config.projectPaths?.[task.project_id] : null;
      if (task.project_id && !projectWorkspace) throw new Error("This repository is not linked on this computer");
      const result = await runAgent(agent, task, {
        ...this.options,
        workspace: projectWorkspace || this.options.workspace,
        allowWrites: task.project_id ? true : this.options.allowWrites,
      });
      const text = (result.text || "").trim().slice(-4000);
      const success = result.code === 0;
      await this.call("complete_task_run", {
        p_device_id: this.config.device.id,
        p_run_id: task.run_id,
        p_status: success ? "completed" : "failed",
        p_result_summary: text || (success ? "Task completed" : "Agent returned no output"),
        p_error_code: success ? null : `agent_exit_${result.code ?? "unknown"}`,
      });
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
      console.log(success ? `Completed in ${Math.round((Date.now() - startedAt) / 1000)}s` : `Failed: ${text.slice(0, 240)}`);
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

import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function collect(stream, chunks, state, onLine) {
  let pending = "";
  stream.on("data", (chunk) => {
    if (state.bytes >= MAX_OUTPUT_BYTES) return;
    const buffer = Buffer.from(chunk);
    chunks.push(buffer.subarray(0, Math.max(0, MAX_OUTPUT_BYTES - state.bytes)));
    state.bytes += buffer.length;
    if (onLine) {
      pending += buffer.toString("utf8");
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      for (const line of lines) if (line.trim()) onLine(line);
    }
  });
  return () => { if (onLine && pending.trim()) onLine(pending); };
}

function spawnAgent(command, args, options, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.workspace,
      env: { ...process.env, ...(options.env || {}), CREWBOARD_TASK_ID: options.taskId },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = []; const stderr = []; const state = { bytes: 0 };
    const flushStdout = collect(child.stdout, stdout, state, options.onLine);
    const flushStderr = collect(child.stderr, stderr, state);
    child.stdin.end(input);
    const timer = setTimeout(() => child.kill(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      flushStdout(); flushStderr();
      resolve({ code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

function promptFor(agent, task) {
  const identity = agent.is_default ? "" : `You are ${agent.name}, an AI teammate in Crewboard.\n\n`;
  const instructions = agent.instructions?.trim() ? `Your standing instructions:\n${agent.instructions.trim()}\n\n` : "";
  if (task.task_kind === "planner") {
    const teammates = Array.isArray(task.split_agents) ? task.split_agents : [];
    return `${identity}${instructions}You are the coordinator for a Crewboard goal. Do not edit files. Inspect the repository only when useful, then divide the goal into concrete, non-overlapping tasks for the available teammates.\n\nGoal: ${task.title}\n\n${task.description || "Plan the work needed to complete this goal."}\n\nAvailable teammates:\n${teammates.map((item) => `- ${item.name} (${item.provider}, ${item.model}) agent_id=${item.id}${item.instructions ? ` — ${item.instructions}` : ""}`).join("\n")}\n\nReturn ONLY valid JSON in this exact shape: {"tasks":[{"title":"short outcome","description":"specific instructions and completion check","agent_id":"one ID above"}]}. Create between 2 and 12 tasks, use every teammate at least once, and make dependencies explicit in descriptions.`;
  }
  return `${identity}${instructions}You are working on a task assigned through Crewboard.\n\nTask: ${task.title}\n\n${task.description || "Complete the requested task."}\n\nWork only inside the provided workspace. Finish the task, then give a concise summary of what you did.`;
}

function normalizedUsage(usage = {}, cost = 0) {
  return {
    inputTokens: Number(usage.input_tokens || 0),
    outputTokens: Number(usage.output_tokens || 0),
    cachedInputTokens: Number(usage.cached_input_tokens || usage.cache_read_input_tokens || 0),
    costUsd: Number(cost || 0),
  };
}

function parseJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function shortText(value, limit = 240) {
  return `${value || ""}`.replace(/\s+/g, " ").trim().slice(0, limit);
}

function friendlyTool(name = "") {
  const normalized = name.toLowerCase();
  if (/read|search|grep|glob|list/.test(normalized)) return "Reading and searching the repository";
  if (/edit|write|patch|create/.test(normalized)) return "Editing project files";
  if (/bash|shell|command|terminal|exec/.test(normalized)) return "Running a project command";
  if (/test|check|lint/.test(normalized)) return "Checking the project";
  return "Using a local development tool";
}

export function progressFromEvent(provider, event) {
  if (!event || typeof event !== "object") return null;
  if (provider === "codex") {
    if (event.type === "thread.started") return { kind: "status", message: "Codex session started" };
    if (event.type === "turn.started") return { kind: "status", message: "Codex is working" };
    if (["item.started", "item.completed"].includes(event.type)) {
      const item = event.item || {};
      if (item.type === "agent_message" && item.text) return { kind: "update", message: shortText(item.text) };
      if (item.type === "command_execution") return { kind: "tool", message: event.type === "item.completed" ? "Finished a project command" : "Running a project command" };
      if (["file_change", "file_write"].includes(item.type)) return { kind: "tool", message: "Editing project files" };
      if (item.type === "mcp_tool_call") return { kind: "tool", message: "Using a connected development tool" };
    }
    if (event.type === "turn.completed") return { kind: "status", message: "Codex finished the run" };
    if (event.type === "error") return { kind: "error", message: shortText(event.message || "Codex reported an error") };
    return null;
  }

  if (event.type === "system" && event.subtype === "init") {
    return { kind: "status", message: `${provider === "cursor" ? "Cursor" : "Claude"} session started${event.model ? ` with ${shortText(event.model, 80)}` : ""}` };
  }
  if (event.type === "tool_call" && event.subtype === "started") {
    const toolName = Object.keys(event.tool_call || {})[0] || "tool";
    return { kind: "tool", message: friendlyTool(toolName) };
  }
  if (event.type === "assistant") {
    const content = Array.isArray(event.message?.content) ? event.message.content : [];
    const tool = content.find((item) => item?.type === "tool_use");
    if (tool) return { kind: "tool", message: friendlyTool(tool.name) };
    const text = content.filter((item) => item?.type === "text").map((item) => item.text).join(" ");
    if (shortText(text)) return { kind: "update", message: shortText(text) };
  }
  if (event.type === "result") return { kind: event.is_error ? "error" : "status", message: event.is_error ? "The agent run failed" : `${provider === "cursor" ? "Cursor" : "Claude"} finished the run` };
  return null;
}

function eventCollector(provider, options, events) {
  return (line) => {
    const event = parseJson(line);
    if (!event) return;
    events.push(event);
    const progress = progressFromEvent(provider, event);
    if (progress) options.onProgress?.(progress);
  };
}

export function parseSplitPlan(value) {
  const raw = `${value || ""}`.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  let parsed = parseJson(fenced || raw);
  if (!parsed) {
    const start = raw.indexOf("{"); const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) parsed = parseJson(raw.slice(start, end + 1));
  }
  const items = Array.isArray(parsed) ? parsed : parsed?.tasks;
  if (!Array.isArray(items) || items.length < 2 || items.length > 12) throw new Error("The coordinator did not return a valid task split");
  const normalized = items.map((item) => ({
    title: shortText(item?.title, 160),
    description: `${item?.description || ""}`.trim().slice(0, 20000),
    agent_id: `${item?.agent_id || ""}`.trim(),
  })).filter((item) => item.title && item.agent_id);
  if (normalized.length < 2) throw new Error("The coordinator did not return a valid task split");
  return normalized;
}

export async function runAgent(agent, task, options) {
  const prompt = promptFor(agent, task);
  const local = agent.local || agent;
  if (agent.provider === "claude") {
    const permissionMode = options.allowWrites ? "acceptEdits" : "plan";
    const events = [];
    const args = [...(local.commandArgs || []), "-p", "--output-format", "stream-json", "--verbose", "--permission-mode", permissionMode];
    if (!agent.is_default && agent.model && agent.model.toLowerCase() !== "default") args.push("--model", agent.model);
    const result = await spawnAgent(local.command, args, { ...options, env: local.env, taskId: task.task_id, onLine: eventCollector("claude", options, events) }, prompt);
    const payload = events.findLast((event) => event.type === "result");
    return {
      ...result,
      text: payload?.result || result.stdout || result.stderr,
      usage: normalizedUsage(payload?.usage, payload?.total_cost_usd),
    };
  }

  if (agent.provider === "codex") {
    const outputPath = path.join(os.tmpdir(), `crewboard-codex-${crypto.randomBytes(6).toString("hex")}.txt`);
    const args = [...(local.commandArgs || []), "exec", "--json", "--skip-git-repo-check", "--sandbox", options.allowWrites ? "workspace-write" : "read-only", "-C", options.workspace, "-o", outputPath];
    if (!agent.is_default && agent.model && agent.model.toLowerCase() !== "default") args.push("--model", agent.model);
    args.push(prompt);
    const events = [];
    const result = await spawnAgent(local.command, args, { ...options, env: local.env, taskId: task.task_id, onLine: eventCollector("codex", options, events) });
    let finalText = result.stdout || result.stderr;
    try { finalText = await readFile(outputPath, "utf8"); } catch { /* Use process output. */ }
    await rm(outputPath, { force: true });
    const completed = events.findLast((event) => event.type === "turn.completed");
    return { ...result, text: finalText, usage: normalizedUsage(completed?.usage) };
  }

  if (agent.provider === "cursor") {
    if (!options.allowWrites) throw new Error("Cursor tasks require a linked repository because Cursor Agent does not expose a read-only sandbox mode");
    const events = [];
    const args = [...(local.commandArgs || []), "-p", "--output-format", "stream-json"];
    args.push("--force");
    if (!agent.is_default && agent.model && !["default", "auto"].includes(agent.model.toLowerCase())) args.push("--model", agent.model);
    args.push(prompt);
    const result = await spawnAgent(local.command, args, { ...options, env: local.env, taskId: task.task_id, onLine: eventCollector("cursor", options, events) });
    const payload = events.findLast((event) => event.type === "result");
    return {
      ...result,
      text: payload?.result || result.stdout || result.stderr,
      usage: normalizedUsage(payload?.usage),
    };
  }
  throw new Error(`Unsupported agent provider: ${agent.provider}`);
}

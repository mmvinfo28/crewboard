import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function collect(stream, chunks, state) {
  stream.on("data", (chunk) => {
    if (state.bytes >= MAX_OUTPUT_BYTES) return;
    const buffer = Buffer.from(chunk);
    chunks.push(buffer.subarray(0, Math.max(0, MAX_OUTPUT_BYTES - state.bytes)));
    state.bytes += buffer.length;
  });
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
    collect(child.stdout, stdout, state); collect(child.stderr, stderr, state);
    child.stdin.end(input);
    const timer = setTimeout(() => child.kill(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}

function promptFor(agent, task) {
  const identity = agent.is_default ? "" : `You are ${agent.name}, an AI teammate in Crewboard.\n\n`;
  const instructions = agent.instructions?.trim() ? `Your standing instructions:\n${agent.instructions.trim()}\n\n` : "";
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

export async function runAgent(agent, task, options) {
  const prompt = promptFor(agent, task);
  const local = agent.local || agent;
  if (agent.provider === "claude") {
    const permissionMode = options.allowWrites ? "acceptEdits" : "plan";
    const args = [...(local.commandArgs || []), "-p", "--output-format", "json", "--permission-mode", permissionMode];
    if (!agent.is_default && agent.model && agent.model.toLowerCase() !== "default") args.push("--model", agent.model);
    const result = await spawnAgent(local.command, args, { ...options, env: local.env, taskId: task.task_id }, prompt);
    const payload = parseJson(result.stdout.trim());
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
    const result = await spawnAgent(local.command, args, { ...options, env: local.env, taskId: task.task_id });
    let finalText = result.stdout || result.stderr;
    try { finalText = await readFile(outputPath, "utf8"); } catch { /* Use process output. */ }
    await rm(outputPath, { force: true });
    const events = result.stdout.split(/\r?\n/).map(parseJson).filter(Boolean);
    const completed = events.findLast((event) => event.type === "turn.completed");
    return { ...result, text: finalText, usage: normalizedUsage(completed?.usage) };
  }

  if (agent.provider === "cursor") {
    if (!options.allowWrites) throw new Error("Cursor tasks require a linked repository because Cursor Agent does not expose a read-only sandbox mode");
    const args = [...(local.commandArgs || []), "-p", "--output-format", "json"];
    args.push("--force");
    if (!agent.is_default && agent.model && !["default", "auto"].includes(agent.model.toLowerCase())) args.push("--model", agent.model);
    args.push(prompt);
    const result = await spawnAgent(local.command, args, { ...options, env: local.env, taskId: task.task_id });
    const payload = parseJson(result.stdout.trim());
    return {
      ...result,
      text: payload?.result || result.stdout || result.stderr,
      usage: normalizedUsage(payload?.usage),
    };
  }
  throw new Error(`Unsupported agent provider: ${agent.provider}`);
}

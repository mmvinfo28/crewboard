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
      env: { ...process.env, CREWBOARD_TASK_ID: options.taskId },
      shell: process.platform === "win32" && !command.toLowerCase().endsWith(".exe"),
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

function promptFor(task) {
  return `You are working on a task assigned through Crewboard.\n\nTask: ${task.title}\n\n${task.description || "Complete the requested task."}\n\nWork only inside the provided workspace. Finish the task, then give a concise summary of what you did.`;
}

export async function runAgent(agent, task, options) {
  const prompt = promptFor(task);
  if (agent.provider === "claude") {
    const permissionMode = options.allowWrites ? "acceptEdits" : "plan";
    const result = await spawnAgent(agent.command, ["-p", "--output-format", "text", "--permission-mode", permissionMode], { ...options, taskId: task.task_id }, prompt);
    return { ...result, text: result.stdout || result.stderr };
  }

  if (agent.provider === "codex") {
    const outputPath = path.join(os.tmpdir(), `crewboard-codex-${crypto.randomBytes(6).toString("hex")}.txt`);
    const args = ["exec", "--skip-git-repo-check", "--sandbox", options.allowWrites ? "workspace-write" : "read-only", "-C", options.workspace, "-o", outputPath, prompt];
    const result = await spawnAgent(agent.command, args, { ...options, taskId: task.task_id });
    let finalText = result.stdout || result.stderr;
    try { finalText = await readFile(outputPath, "utf8"); } catch { /* Use process output. */ }
    await rm(outputPath, { force: true });
    return { ...result, text: finalText };
  }
  throw new Error(`Unsupported agent provider: ${agent.provider}`);
}


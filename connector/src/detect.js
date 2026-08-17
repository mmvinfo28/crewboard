import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function resolveCommand(command) {
  if (process.platform !== "win32" || path.extname(command)) return command;
  const result = spawnSync("where.exe", [command], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return command;
  return `${result.stdout}`
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => /\.(exe|com)$/i.test(candidate)) || command;
}

function commandWorks(command, versionArgs = ["--version"], env = {}) {
  try {
    const resolvedCommand = resolveCommand(command);
    const result = spawnSync(resolvedCommand, versionArgs, {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    const version = result.status === 0 ? `${result.stdout || result.stderr}`.trim() : "";
    return version ? { command: resolvedCommand, version } : null;
  } catch { return null; }
}

function codexCandidates() {
  const candidates = [process.env.CREWBOARD_CODEX_BIN, process.env.SWARM_CODEX_BIN, "codex"].filter(Boolean);
  const local = process.env.LOCALAPPDATA;
  if (local) candidates.push(
    path.join(local, "OpenAI", "Codex", "bin", "codex.exe"),
    path.join(local, "Microsoft", "WindowsApps", "codex.exe"),
  );
  return [...new Set(candidates)];
}

function claudeCandidates() {
  const candidates = [process.env.CREWBOARD_CLAUDE_BIN].filter(Boolean);
  if (process.platform === "win32" && process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
  }
  candidates.push("claude");
  return [...new Set(candidates)];
}

function cursorCandidates() {
  const candidates = [];
  if (process.env.CREWBOARD_CURSOR_BIN) candidates.push({ command: process.env.CREWBOARD_CURSOR_BIN, commandArgs: [] });
  candidates.push({ command: "agent", commandArgs: [] }, { command: "cursor-agent", commandArgs: [] });

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const installRoot = path.join(process.env.LOCALAPPDATA, "Programs", "cursor");
    const executable = path.join(installRoot, "Cursor.exe");
    const cliScript = path.join(installRoot, "resources", "app", "out", "cli.js");
    if (existsSync(executable) && existsSync(cliScript)) {
      candidates.unshift({
        command: executable,
        commandArgs: [cliScript, "agent"],
        versionArgs: [cliScript, "--version"],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      });
    }
  }
  return candidates;
}

function configuredCodexModel() {
  try {
    const root = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    const match = readFileSync(path.join(root, "config.toml"), "utf8").match(/^\s*model\s*=\s*"([^"]+)"/m);
    return match?.[1] || "Codex";
  } catch { return "Codex"; }
}

export function detectAgents() {
  const agents = [];
  for (const candidate of claudeCandidates()) {
    if (candidate !== "claude" && !existsSync(candidate)) continue;
    const detected = commandWorks(candidate);
    if (!detected) continue;
    agents.push({
      provider: "claude",
      name: "Claude Code",
      model: detected.version.split(/\r?\n/)[0].slice(0, 100),
      command: detected.command,
      capabilities: ["text", "code", "filesystem"],
    });
    break;
  }

  for (const candidate of codexCandidates()) {
    if (candidate !== "codex" && !existsSync(candidate)) continue;
    const detected = commandWorks(candidate);
    if (!detected) continue;
    agents.push({
      provider: "codex",
      name: "Codex",
      model: configuredCodexModel(),
      command: detected.command,
      capabilities: ["text", "code", "filesystem"],
    });
    break;
  }


  for (const candidate of cursorCandidates()) {
    if (path.isAbsolute(candidate.command) && !existsSync(candidate.command)) continue;
    const detected = commandWorks(candidate.command, candidate.versionArgs, candidate.env);
    if (!detected) continue;
    agents.push({
      provider: "cursor",
      name: "Cursor Agent",
      model: "Auto",
      command: detected.command,
      commandArgs: candidate.commandArgs,
      env: candidate.env,
      capabilities: ["text", "code", "filesystem"],
    });
    break;
  }
  return agents;
}

export function platformName() {
  return process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : "unknown";
}

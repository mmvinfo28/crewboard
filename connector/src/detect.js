import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function commandWorks(command) {
  try {
    const needsShell = process.platform === "win32" && !/\.(exe|com)$/i.test(command);
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      shell: needsShell,
      timeout: 15000,
      windowsHide: true,
    });
    return result.status === 0 ? `${result.stdout || result.stderr}`.trim() : "";
  } catch { return ""; }
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
    const claudeVersion = commandWorks(candidate);
    if (!claudeVersion) continue;
    agents.push({
      provider: "claude",
      name: "Claude Code",
      model: claudeVersion.split(/\r?\n/)[0].slice(0, 100),
      command: candidate,
      capabilities: ["text", "code", "filesystem"],
    });
    break;
  }

  for (const candidate of codexCandidates()) {
    if (candidate !== "codex" && !existsSync(candidate)) continue;
    const version = commandWorks(candidate);
    if (!version) continue;
    agents.push({
      provider: "codex",
      name: "Codex",
      model: configuredCodexModel(),
      command: candidate,
      capabilities: ["text", "code", "filesystem"],
    });
    break;
  }
  return agents;
}

export function platformName() {
  return process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : "unknown";
}

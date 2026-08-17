import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

function windowsStartupPath() {
  if (process.platform !== "win32" || !process.env.APPDATA) return null;
  return path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Crewboard Connector.cmd");
}

export async function installStartup(serverUrl) {
  const startupPath = windowsStartupPath();
  if (!startupPath) return false;
  await mkdir(path.dirname(startupPath), { recursive: true });
  const script = [
    "@echo off",
    "title Crewboard Connector",
    `npx --yes github:mmvinfo28/crewboard#connector-v0.4.3 start --url "${serverUrl}"`,
    "",
  ].join("\r\n");
  await writeFile(startupPath, script, { encoding: "utf8", mode: 0o600 });
  return true;
}

export async function removeStartup() {
  const startupPath = windowsStartupPath();
  if (!startupPath) return false;
  await rm(startupPath, { force: true });
  return true;
}

export async function startupEnabled() {
  const startupPath = windowsStartupPath();
  if (!startupPath) return false;
  try { await access(startupPath); return true; } catch { return false; }
}

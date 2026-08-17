import { spawn, spawnSync } from "node:child_process";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { configStorageDirectory } from "./config.js";

const statePath = path.join(configStorageDirectory(), "connector-process.json");
const logPath = path.join(configStorageDirectory(), "connector.log");

function isAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function saveState(pid) {
  await mkdir(configStorageDirectory(), { recursive: true, mode: 0o700 });
  await writeFile(statePath, `${JSON.stringify({ pid, startedAt: new Date().toISOString() }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function managedStatus() {
  const state = await readState();
  if (!state || !isAlive(state.pid)) {
    if (state) await rm(statePath, { force: true });
    return { running: false, pid: null, logPath };
  }
  return { running: true, pid: state.pid, startedAt: state.startedAt, logPath };
}

export async function startManaged(args = []) {
  const current = await managedStatus();
  if (current.running) return { ...current, started: false };

  await mkdir(configStorageDirectory(), { recursive: true, mode: 0o700 });
  const log = await open(logPath, "a", 0o600);
  try {
    const child = spawn(process.execPath, [process.argv[1], "run", ...args], {
      cwd: process.cwd(),
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log.fd, log.fd],
    });
    child.unref();
    await saveState(child.pid);
    return { running: true, pid: child.pid, logPath, started: true };
  } finally {
    await log.close();
  }
}

export async function stopManaged() {
  const current = await managedStatus();
  if (!current.running) return { stopped: false, logPath };
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", `${current.pid}`, "/T", "/F"], { encoding: "utf8", windowsHide: true });
  } else {
    process.kill(current.pid, "SIGTERM");
  }
  await rm(statePath, { force: true });
  return { stopped: true, pid: current.pid, logPath };
}

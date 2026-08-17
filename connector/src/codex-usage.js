import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function quotaWindow(value) {
  if (!value || typeof value !== "object") return null;
  return {
    usedPercent: finiteNumber(value.usedPercent),
    windowMinutes: finiteNumber(value.windowDurationMins),
    resetsAt: finiteNumber(value.resetsAt),
  };
}

export function normalizeCodexAccountUsage(accountResult = {}, limitsResult = {}, usageResult = {}) {
  const buckets = limitsResult.rateLimitsByLimitId || {};
  const limit = limitsResult.rateLimits || buckets.codex || Object.values(buckets)[0] || null;
  if (!limit) return null;

  const dailyBuckets = Array.isArray(usageResult.dailyUsageBuckets) ? usageResult.dailyUsageBuckets : [];
  const today = new Date().toISOString().slice(0, 10);
  const latestDaily = dailyBuckets.findLast((bucket) => bucket?.startDate === today) || dailyBuckets.at(-1);

  return {
    planType: accountResult.account?.planType || limit.planType || null,
    primary: quotaWindow(limit.primary),
    secondary: quotaWindow(limit.secondary),
    lifetimeTokens: finiteNumber(usageResult.summary?.lifetimeTokens),
    dailyTokens: finiteNumber(latestDaily?.tokens),
  };
}

export function codexLoginStatus(codex) {
  if (!codex?.command) return { authenticated: false, message: "Codex is not installed" };
  const result = spawnSync(codex.command, [...(codex.commandArgs || []), "login", "status"], {
    encoding: "utf8",
    env: { ...process.env, ...(codex.env || {}) },
    windowsHide: true,
    timeout: 15_000,
  });
  const message = `${result.stdout || result.stderr || ""}`.trim();
  return { authenticated: result.status === 0, message: message || (result.status === 0 ? "Signed in" : "Not logged in") };
}

export function startCodexLogin(codex) {
  if (!codex?.command) return Promise.reject(new Error("Codex is not installed"));
  return new Promise((resolve, reject) => {
    const child = spawn(codex.command, [...(codex.commandArgs || []), "login"], {
      env: { ...process.env, ...(codex.env || {}) },
      shell: false,
      windowsHide: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Codex sign-in exited with code ${code ?? "unknown"}`)));
  });
}

export async function readCodexAccountUsage(codex, { timeoutMs = 20_000 } = {}) {
  if (!codex?.command) return null;
  const child = spawn(codex.command, [...(codex.commandArgs || []), "app-server"], {
    env: { ...process.env, ...(codex.env || {}) },
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  let processError = null;

  const rejectPending = (error) => {
    processError = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.once("error", rejectPending);
  child.once("close", (code) => {
    if (pending.size) rejectPending(new Error(`Codex app-server exited before returning usage (${code ?? "unknown"})`));
  });
  lines.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id === undefined || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message || "Codex app-server request failed"));
    else request.resolve(message.result || {});
  });

  const send = (message) => {
    if (processError) throw processError;
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out reading Codex account usage (${method})`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try { send({ method, id, ...(params === undefined ? {} : { params }) }); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });

  try {
    await request("initialize", {
      clientInfo: { name: "crewboard_connector", title: "Crewboard Connector", version: "0.4.3" },
    });
    send({ method: "initialized", params: {} });
    const [account, limits, usage] = await Promise.all([
      request("account/read", { refreshToken: false }),
      request("account/rateLimits/read"),
      request("account/usage/read"),
    ]);
    return normalizeCodexAccountUsage(account, limits, usage);
  } finally {
    for (const request of pending.values()) clearTimeout(request.timer);
    pending.clear();
    lines.close();
    if (!child.killed) child.kill();
  }
}

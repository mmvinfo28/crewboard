import os from "node:os";
import path from "node:path";
import { normalizeServerUrl, redeemPairing, startPairing } from "./api.js";
import { clearConfig, configLocation, loadConfig, saveConfig } from "./config.js";
import { Connector } from "./connector.js";
import { detectAgents, platformName } from "./detect.js";

const VERSION = "0.1.0";
const DEFAULT_SERVER = process.env.CREWBOARD_URL || "https://crewboard.vercel.app";

function argument(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function help() {
  console.log(`Crewboard connector ${VERSION}\n\nCommands:\n  connect          Pair this computer and start listening\n  run              Start using a saved pairing\n  status           Show detected local agents\n  disconnect       Remove the saved pairing from this computer\n\nOptions:\n  --url <url>       Crewboard server URL\n  --workspace <dir> Folder agents may work inside (default: current folder)\n  --allow-writes    Allow Claude and Codex to edit workspace files`);
}

async function waitForApproval(serverUrl, challenge) {
  const deadline = new Date(challenge.expiresAt).getTime();
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, challenge.pollAfterSeconds) * 1000));
    try { return await redeemPairing(serverUrl, challenge.code, challenge.pairingSecret); }
    catch (error) { if (error.code === "pairing_not_ready" || error.status === 409) continue; throw error; }
  }
  throw new Error("The pairing code expired. Run connect again");
}

function connectorOptions(args) {
  return {
    workspace: path.resolve(argument(args, "--workspace", process.cwd())),
    allowWrites: args.includes("--allow-writes"),
  };
}

async function connect(args) {
  const serverUrl = normalizeServerUrl(argument(args, "--url", DEFAULT_SERVER));
  const agents = detectAgents();
  if (!agents.length) throw new Error("No supported local agents found. Install or sign in to Claude Code or Codex first");
  console.log(`Detected: ${agents.map((agent) => agent.name).join(", ")}`);
  const challenge = await startPairing(serverUrl, {
    deviceName: os.hostname(), platform: platformName(), connectorVersion: VERSION,
  });
  console.log(`\nPairing code: ${challenge.code}`);
  console.log(`Open ${serverUrl}/devices, choose Connect device, and enter this code.`);
  console.log("Waiting for approval…");
  const credentials = await waitForApproval(serverUrl, challenge);
  const config = {
    version: 1,
    connectorVersion: VERSION,
    serverUrl,
    tokenEndpoint: credentials.tokenEndpoint,
    refreshToken: credentials.refreshToken,
    device: credentials.device,
    session: credentials.session,
    pairedAt: new Date().toISOString(),
  };
  await saveConfig(config);
  console.log(`Approved. Credentials saved locally at ${configLocation()}.`);
  await new Connector(config, agents, connectorOptions(args)).start();
}

async function run(args) {
  const config = await loadConfig();
  if (!config) throw new Error("This computer is not paired. Run crewboard connect first");
  const agents = detectAgents();
  if (!agents.length) throw new Error("No supported local agents found");
  await new Connector(config, agents, connectorOptions(args)).start();
}

async function status() {
  const config = await loadConfig();
  const agents = detectAgents();
  console.log(`Pairing: ${config ? `saved for device ${config.device?.id}` : "not configured"}`);
  console.log(`Config: ${configLocation()}`);
  console.log(`Local agents: ${agents.length ? agents.map((agent) => `${agent.name} (${agent.model})`).join(", ") : "none detected"}`);
}

export async function main(args) {
  const command = args[0] || "help";
  if (command === "connect") return connect(args.slice(1));
  if (command === "run") return run(args.slice(1));
  if (command === "status") return status();
  if (command === "disconnect") { await clearConfig(); console.log("Local Crewboard pairing removed."); return; }
  help();
  if (!["help", "--help", "-h"].includes(command)) process.exitCode = 1;
}


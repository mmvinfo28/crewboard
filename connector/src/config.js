import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const configDirectory = process.env.CREWBOARD_CONFIG_DIR
  || (process.platform === "win32"
    ? path.join(process.env.APPDATA || os.homedir(), "Crewboard")
    : path.join(os.homedir(), ".config", "crewboard"));
const configPath = path.join(configDirectory, "connector.json");

export async function loadConfig() {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw new Error("The local connector configuration is unreadable");
  }
}

export async function saveConfig(value) {
  await mkdir(configDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rm(configPath, { force: true });
  await rename(temporaryPath, configPath);
  await chmod(configPath, 0o600).catch(() => {});
}

export async function clearConfig() {
  await rm(configPath, { force: true });
}

export function configLocation() {
  return configPath;
}

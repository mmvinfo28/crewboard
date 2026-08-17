import { execFile, spawnSync } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { configStorageDirectory } from "./config.js";

const execFileAsync = promisify(execFile);

export function pathFingerprint(deviceId, folderPath) {
  const normalized = path.resolve(folderPath).replace(/[\\/]+$/, "");
  const stablePath = process.platform === "win32" ? normalized.toLowerCase() : normalized;
  return crypto.createHash("sha256").update(`${deviceId}\0${stablePath}`).digest("hex");
}

async function pickOnWindows() {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$picker = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$picker.Description = 'Choose the repository Crewboard may access'",
    "$picker.ShowNewFolderButton = $false",
    "$owner = New-Object System.Windows.Forms.Form",
    "$owner.ShowInTaskbar = $false",
    "$owner.TopMost = $true",
    "$owner.Opacity = 0",
    "$owner.StartPosition = 'CenterScreen'",
    "$owner.Show()",
    "$owner.Activate()",
    "$result = $picker.ShowDialog($owner)",
    "$selectedPath = $picker.SelectedPath",
    "$owner.Close()",
    "$owner.Dispose()",
    "$picker.Dispose()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($selectedPath) }",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    timeout: 10 * 60 * 1000,
    windowsHide: true,
  });
  return stdout.trim() || null;
}

async function pickOnMac() {
  const { stdout } = await execFileAsync("osascript", [
    "-e",
    'POSIX path of (choose folder with prompt "Choose the repository Crewboard may access")',
  ], { timeout: 10 * 60 * 1000 });
  return stdout.trim().replace(/\/$/, "") || null;
}

async function pickOnLinux() {
  const { stdout } = await execFileAsync("zenity", [
    "--file-selection",
    "--directory",
    "--title=Choose the repository Crewboard may access",
  ], { timeout: 10 * 60 * 1000 });
  return stdout.trim() || null;
}

export async function pickRepositoryFolder() {
  try {
    if (process.platform === "win32") return await pickOnWindows();
    if (process.platform === "darwin") return await pickOnMac();
    if (process.platform === "linux") return await pickOnLinux();
    throw new Error(`Folder selection is not supported on ${process.platform}`);
  } catch (error) {
    if (error?.code === 1 || error?.code === "1") return null;
    throw error;
  }
}

export function normalizeGitHubRepositoryUrl(value) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error("Enter a complete GitHub URL, such as https://github.com/crew/project"); }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com"
    || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Crewboard currently accepts HTTPS links from github.com only");
  }
  const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new Error("GitHub repository links must look like https://github.com/owner/repository");
  }
  const repository = parts[1].replace(/\.git$/i, "");
  if (!repository) throw new Error("GitHub repository name is missing");
  return { url: `https://github.com/${parts[0]}/${repository}.git`, slug: `${parts[0]}-${repository}` };
}

async function directoryExists(value) {
  try { return (await stat(value)).isDirectory(); } catch { return false; }
}

function commandAvailable(command) {
  const probe = spawnSync(process.platform === "win32" ? "where.exe" : "which", [command], {
    encoding: "utf8", windowsHide: true,
  });
  return probe.status === 0;
}

export async function cloneGitHubRepository(repositoryUrl, requestId) {
  const repository = normalizeGitHubRepositoryUrl(repositoryUrl);
  const repositoriesRoot = path.join(configStorageDirectory(), "repositories");
  const target = path.join(repositoriesRoot, `${repository.slug}-${requestId.slice(0, 8)}`);
  await mkdir(repositoriesRoot, { recursive: true, mode: 0o700 });
  if (await directoryExists(path.join(target, ".git"))) return target;
  await rm(target, { recursive: true, force: true });

  try {
    if (commandAvailable("gh")) {
      const repoName = repository.url.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
      await execFileAsync("gh", ["repo", "clone", repoName, target, "--", "--depth=1"], {
        timeout: 10 * 60 * 1000, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
      });
    } else {
      await execFileAsync("git", ["clone", "--depth=1", "--", repository.url, target], {
        timeout: 10 * 60 * 1000, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
      });
    }
    return target;
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    const detail = `${error?.stderr || error?.message || "Clone failed"}`.trim().split(/\r?\n/).slice(-2).join(" ");
    throw new Error(`Could not clone the GitHub repository. Check your local GitHub login. ${detail}`.slice(0, 500));
  }
}

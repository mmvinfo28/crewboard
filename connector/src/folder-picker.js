import { execFile } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

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

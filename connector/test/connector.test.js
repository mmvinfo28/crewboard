import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { normalizeServerUrl } from "../src/api.js";
import { pathFingerprint } from "../src/folder-picker.js";

const execFileAsync = promisify(execFile);

test("normalizes the hosted server URL", () => {
  assert.equal(normalizeServerUrl("https://crewboard.example/path"), "https://crewboard.example");
  assert.throws(() => normalizeServerUrl("file:///tmp/crewboard"), /HTTP or HTTPS/);
});

test("creates an opaque stable folder fingerprint", () => {
  const first = pathFingerprint("device-1", path.join("folder", "repository"));
  const second = pathFingerprint("device-1", path.join("folder", "repository"));
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /repository/);
});

test("status detects a local CLI without exposing credentials", async () => {
  const configDirectory = await mkdtemp(path.join(os.tmpdir(), "crewboard-connector-test-"));
  try {
    const { stdout } = await execFileAsync(process.execPath, ["bin/crewboard.js", "status"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: { ...process.env, CREWBOARD_CONFIG_DIR: configDirectory, CREWBOARD_CLAUDE_BIN: process.execPath, CREWBOARD_CODEX_BIN: "missing-codex" },
      timeout: 20_000,
    });
    assert.match(stdout, /Pairing: not configured/);
    assert.match(stdout, /Local agents: (?!none detected)/);
    assert.doesNotMatch(stdout, /refreshToken/);
  } finally {
    await rm(configDirectory, { recursive: true, force: true });
  }
});

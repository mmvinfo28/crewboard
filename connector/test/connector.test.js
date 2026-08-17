import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { normalizeServerUrl } from "../src/api.js";
import { normalizeGitHubRepositoryUrl, pathFingerprint } from "../src/folder-picker.js";
import { parseSplitPlan, progressFromEvent } from "../src/runner.js";

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

test("accepts only normal GitHub repository URLs", () => {
  assert.deepEqual(normalizeGitHubRepositoryUrl("https://github.com/crew/project"), {
    url: "https://github.com/crew/project.git",
    slug: "crew-project",
  });
  assert.throws(() => normalizeGitHubRepositoryUrl("https://example.com/crew/project"), /github.com only/);
  assert.throws(() => normalizeGitHubRepositoryUrl("https://github.com/crew/project/issues"), /must look like/);
});

test("parses a strict automatic task split", () => {
  const items = parseSplitPlan('```json\n{"tasks":[{"title":"Build UI","description":"Finish it","agent_id":"one"},{"title":"Test UI","description":"Verify it","agent_id":"two"}]}\n```');
  assert.equal(items.length, 2);
  assert.equal(items[1].agent_id, "two");
  assert.throws(() => parseSplitPlan('{"tasks":[]}'), /valid task split/);
});

test("turns provider events into sanitized progress", () => {
  assert.deepEqual(progressFromEvent("codex", { type: "item.started", item: { type: "command_execution", command: "secret" } }), {
    kind: "tool", message: "Running a project command",
  });
  assert.deepEqual(progressFromEvent("claude", { type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "secret" } }] } }), {
    kind: "tool", message: "Reading and searching the repository",
  });
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

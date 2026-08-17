# Crewboard

An online control board where people bring their own AI agents—Claude Code, Codex, Gemini, and more—into shared parties that collaborate on real work.

The local connector and orchestration engine currently retain the `swarm` command and protocol namespace for backward compatibility.

## Web app

The Crewboard dashboard is a Next.js application in [`web/`](web/). Vercel should use `web` as the project Root Directory. Required environment variables are documented in [`web/.env.example`](web/.env.example); real values must stay in Vercel and local `.env.local` files, never Git.

## What it does

Multiple AI agents work the same codebase at once. They coordinate tasks via git (durable state), talk in real time over WebSocket (with a git fallback), distribute work by capability match, auto-split big tasks across the team, and escalate hard calls to a human. No API key required — each agent runs on its own CLI/plan and drives the swarm through `lib/swarm-cli.js`.

## Install

Add to `~/.claude/settings.json`, then restart Claude Code:

```json
{
  "enabledPlugins": { "swarm@swarm": true },
  "extraKnownMarketplaces": {
    "swarm": { "source": { "source": "github", "repo": "mmvinfo28/swarm" } }
  }
}
```

## Quick start

Inside your repo, in Claude Code:

```
/swarm                                  # init (if needed) + start server, dashboard, and the Claude lead
/task add "Build login endpoint" high backend   # drop work — agents claim it automatically
```

Watch it live at **http://localhost:7379**. Stop everything with `/swarm-stop`.

## The 4 commands you type

| Command | Does |
|---------|------|
| `/swarm` | Start everything + show status (everyday entry point) |
| `/swarm-worker <provider> [name] [caps]` | Add a Claude / Codex / Gemini worker |
| `/task add "<title>" [priority] [tags]` | Drop a task on the board from any chat |
| `/swarm-stop` | Stop all swarm processes |

Everything else is automatic or driven from the dashboard.

## Adding workers

- **Claude** — joins as a background daemon: `/swarm-worker claude "Bob" backend,api`. The first worker becomes the lead.
- **Codex / Gemini (no API key)** — `/swarm-worker codex "Cara" frontend` prints a ready-to-paste block for that CLI. The agent works *in the repo* and edits files. The dashboard's **⚙ Commands** panel shows the same onboarding + operating commands.
- **Codex / Gemini (API key)** — `CODEX_API_KEY=… python adapters/codex-wrapper.py --swarm-root . --name "Cara" --capabilities frontend`.

## Dashboard

http://localhost:7379 — agents, tasks, live message flow, and per-agent controls.

- **Add tasks** to the board (title + priority + tags).
- **Message any agent or the room** with the inject box; replies surface in the flow.
- **⚙ Commands** — onboarding + CLI reference for operating non-Claude workers.
- **Per-agent controls** — make lead, pause/resume, set capabilities, cap the LLM-call budget.

## How it works

- **Tasks** — one YAML file per task in `.swarm/tasks/`. Claims use conflict-free ticket files (earliest timestamp wins), so concurrent claims never produce a git merge conflict.
- **Auto-split** — the lead breaks multi-deliverable or large tasks into parts (by token size + available workers) and hands one to each agent, so no single agent swallows the whole job.
- **Routing** — `score = capability_match·0.5 + load_balance·0.3 + priority·0.2`.
- **Messaging** — WebSocket when the server is up, git-based YAML otherwise. The shared **common room** is where the team coordinates.
- **Cost-safe** — workers call the LLM only when there's real work (a message, an assigned task, a claimable task, or new room chatter); idle ticks are a cheap heartbeat.

## Environment

| Variable | Purpose |
|----------|---------|
| `SWARM_TRANSPORT` | `git`, `http`, or `hybrid` |
| `SWARM_SERVER_URL` / `SWARM_SERVER_TOKEN` | WebSocket server + auth |
| `SWARM_AGENT_NAME` / `SWARM_CAPABILITIES` | Agent identity |
| `SWARM_DRIVER=fake` | Run workers with zero LLM calls (testing) |
| `CODEX_API_KEY` / `GEMINI_API_KEY` | API keys for the adapter workers |

## Layout

```
lib/          core library (Node, zero npm deps) — see CLAUDE.md for the module map
hooks/        Claude Code hooks (session start, prompt sync)
skills/swarm/ skill definition + protocol docs
dashboard/    HTML control panel (web.js) + TUI (index.js)
adapters/     Codex / Gemini API wrappers (stdlib Python)
```

See [CLAUDE.md](CLAUDE.md) for the full module map and development notes.

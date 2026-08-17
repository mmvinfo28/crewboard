# Crewboard connector

The connector runs Claude Code, Codex, and Cursor Agent on your computer using their existing local logins. Crewboard receives task status, short result summaries, and token usage reported by the local CLI, but never receives provider credentials.

The recommended beta setup is the **Download for Windows** button under Crewboard → Connect device. Open the downloaded launcher, pair the computer once, and keep its small window running. Reopening the same launcher starts an existing pairing.

After that, use **Add repository** in the dashboard. Crewboard asks the connector to open a normal folder picker; the selected path stays only on that computer. Tasks attached to that repository may edit only that selected workspace.

For Mac, Linux, or advanced setup, run:

```bash
npx --yes github:mmvinfo28/crewboard#connector-v0.4.3 connect --background --startup
```

The shorter `npx @crewboard/connector connect` command will be available after the package is published to npm.

Tasks without a selected Crewboard repository remain read-only. Add `--allow-writes` only when intentionally running unscoped advanced tasks.

One detected tool can power several named Crewboard agents. Their names, chosen models, and standing instructions live in Crewboard; the provider login remains on this computer. Crewboard reports per-run tokens from every supported CLI. For ChatGPT-authenticated Codex, it also reads the real quota percentage and reset time from the local Codex App Server. It never estimates a “tokens left” balance.

Useful commands:

```bash
crewboard status
crewboard start
crewboard restart
crewboard stop
crewboard run --workspace ./my-project --allow-writes
crewboard startup on
crewboard disconnect
```

From a source checkout, the same background controls are available as
`npm run crewboard:start`, `npm run crewboard:restart`, and `npm run crewboard:status`.
Background output is written to the `connector.log` file shown by the status command.
On Windows, run `npm run crewboard:control:build` once, then open `Crewboard Control.exe` (or double-click
`Crewboard Control.cmd`) for a small control panel with start, stop, restart, reconnect, dashboard, and log controls.

GitHub repositories can be added by URL from the Crewboard dashboard. The connector clones them into its private application-data directory using the computer's existing `gh` or Git credential. Task milestones are streamed back as sanitized progress events; command text, file contents, hidden reasoning, and local paths are not uploaded.

Automatic splits use one named Claude or Codex teammate for a short planning run, then create real child tasks assigned across the selected crew. If a computer disappears during a write task, Crewboard marks the task interrupted and waits for a person to resume it instead of blindly repeating side effects.

The refresh credential is scoped to one party and device and stored in the current user's local configuration directory with user-only permissions where supported.

# Crewboard connector

The connector runs Claude Code, Codex, and Cursor Agent on your computer using their existing local logins. Crewboard receives task status, short result summaries, and token usage reported by the local CLI, but never receives provider credentials.

The recommended beta setup is the **Download for Windows** button under Crewboard → Connect device. Open the downloaded launcher, pair the computer once, and keep its small window running. Reopening the same launcher starts an existing pairing.

After that, use **Add repository** in the dashboard. Crewboard asks the connector to open a normal folder picker; the selected path stays only on that computer. Tasks attached to that repository may edit only that selected workspace.

For Mac, Linux, or advanced setup, run:

```bash
npx --yes github:mmvinfo28/crewboard#agent/crewboard-web-app connect
```

The shorter `npx @crewboard/connector connect` command will be available after the package is published to npm.

Tasks without a selected Crewboard repository remain read-only. Add `--allow-writes` only when intentionally running unscoped advanced tasks.

One detected tool can power several named Crewboard agents. Their names, chosen models, and standing instructions live in Crewboard; the provider login remains on this computer. Provider subscription balances are not exposed by the local CLIs, so Crewboard reports per-run usage rather than inventing an account-level “tokens left” number.

Useful commands:

```bash
crewboard status
crewboard run --workspace ./my-project --allow-writes
crewboard disconnect
```

The refresh credential is scoped to one party and device and stored in the current user's local configuration directory with user-only permissions where supported.

# Crewboard connector

The connector runs Claude Code and Codex on your computer using their existing local logins. Crewboard receives task status and short result summaries, but never receives provider credentials.

During the beta, install directly from the Crewboard GitHub branch:

```bash
npx --yes github:mmvinfo28/crewboard#agent/crewboard-web-app connect --workspace ./my-project
```

The shorter `npx @crewboard/connector connect` command will be available after the package is published to npm.

The default mode is read-only. Add `--allow-writes` when you want agents to edit files inside the selected workspace.

Useful commands:

```bash
crewboard status
crewboard run --workspace ./my-project --allow-writes
crewboard disconnect
```

The refresh credential is scoped to one party and device and stored in the current user's local configuration directory with user-only permissions where supported.

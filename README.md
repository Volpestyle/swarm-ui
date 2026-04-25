# swarm-ui

Desktop control plane for `swarm-mcp`.

This app lives at `apps/swarm-ui` inside `Volpestyle/swarm-mcp`. The Tauri
crate depends on the parent workspace crates through relative paths:

- `../../../crates/swarm-protocol`
- `../../../crates/swarm-state`
- `../../../crates/swarm-schema`

The app talks to the Rust `swarm-server` daemon over a local Unix domain
socket. On startup it launches the daemon when the socket is unavailable. See
[`../../docs/swarm-server.md`](../../docs/swarm-server.md) for server behavior,
pairing, PTY leases, and mobile access.

## Development

From the `swarm-mcp` repo root:

```bash
bun run check:ui
cargo test --manifest-path apps/swarm-ui/src-tauri/Cargo.toml
```

From this directory when it is checked out at `apps/swarm-ui`:

```bash
bun run check
bun run build
cargo test --manifest-path src-tauri/Cargo.toml
```

Run the desktop app from this directory with the local Tauri CLI:

```bash
bunx tauri dev
```

Useful daemon knobs:

- `SWARM_SERVER_BIN=/path/to/swarm-server` tells the app which server binary to launch.
- `SWARM_DB_PATH=/path/to/swarm.db` points both UI and server at a non-default swarm database.
- `SWARM_SERVER_PORT=5444` changes the HTTPS/WSS port used by paired devices.

Role presets for the launcher are read from
`$XDG_CONFIG_HOME/swarm-ui/role-presets.json`. The built-in roles are
`planner`, `implementer`, `reviewer`, and `researcher`.

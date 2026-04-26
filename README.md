# swarm-ui

Desktop control plane for `swarm-mcp`.

This app lives at `apps/swarm-ui` inside `Volpestyle/swarm-mcp`. The Tauri
crate depends on the parent workspace crates through relative paths:

- `../../../crates/swarm-protocol`
- `../../../crates/swarm-state`
- `../../../crates/swarm-schema`

The app talks to the Rust `swarm-server` daemon over a local Unix domain
socket. Managed startup is available, but the recommended dev flow keeps the
daemon and UI in separate terminals so rebuilds are explicit. See
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

Recommended split dev flow from the `swarm-mcp` repo root:

```bash
# Terminal 1
bun run dev:server

# Terminal 2
bun run dev:ui
```

Run the desktop app from this directory with daemon auto-start disabled:

```bash
bun run tauri:dev
```

Use `bun run tauri:dev:managed` if you want the desktop app to launch
`swarm-server` for you.

Useful daemon knobs:

- `SWARM_SERVER_BIN=/path/to/swarm-server` tells the app which server binary to launch.
- `SWARM_UI_MANAGE_DAEMON=0` makes the app require a separately-started daemon instead of launching one itself.
- `SWARM_DB_PATH=/path/to/swarm.db` points both UI and server at a non-default swarm database.
- `SWARM_SERVER_PORT=5444` changes the HTTPS/WSS port used by paired devices.

Role presets for the launcher are read from
`$XDG_CONFIG_HOME/swarm-ui/role-presets.json`. The built-in roles are
`planner`, `implementer`, `reviewer`, and `researcher`.

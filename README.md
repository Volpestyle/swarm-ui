# swarm-ui

Desktop control plane for `swarm-mcp`.

This repository is intended to be checked out as `apps/swarm-ui` inside
`Volpestyle/swarm-mcp`. The Tauri crate currently depends on the parent
workspace crates through relative paths:

- `../../../crates/swarm-protocol`
- `../../../crates/swarm-state`

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

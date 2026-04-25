# Agent Guidance

## Error Presentation

- In Swarm UI, user-facing errors should render as static in-UI, dismissible alerts near the surface that raised them.
- Do not use transient toast messages for errors. Errors must remain visible until the user dismisses them, the action succeeds, or the owning view resets.
- Keep `console.error`/`console.warn` for diagnostics, but do not rely on console output as the only visible error path.
- Non-error confirmations may use lighter transient treatment if one is introduced later; this exception does not apply to errors.

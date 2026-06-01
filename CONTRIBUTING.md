# Contributing

Thanks for helping improve SpriteSplit.

## Development rules

- Keep the desktop workflow functional on Windows first.
- Preserve the split between UI, Tauri bridge, and Python core.
- Keep AI integration optional.
- Do not hardcode provider secrets or closed service credentials.
- Prefer export schema changes that remain backward-compatible when possible.

## Pull request checklist

- Explain the user-facing change clearly.
- Include screenshots or short recordings for UI work.
- Run `npm run lint`.
- Run `npm run build`.
- Run `npm run test:python`.
- Note any new environment requirements or permissions.

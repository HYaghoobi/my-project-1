<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project files

- `src/app/page.tsx` renders the authenticated Kanban board and mounts the assistant chat.
- `src/app/assistant-chat.tsx` loads chat history, sends messages, and presents approval or rejection actions for proposals.
- `src/lib/api.ts` contains the authenticated client for board and assistant endpoints.
- `src/lib/i18n.ts` contains Persian and English UI strings used by the board and assistant.
- Run unit tests and lint with `npm test` and `npm run lint`; run browser tests with `npm run test:e2e`.

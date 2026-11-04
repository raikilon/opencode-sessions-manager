# OpenCode Session Keeper

A local dashboard for finding and cleaning up OpenCode sessions across projects.

## Run locally

Requirements: Node.js 24.15+ and **OpenCode 2.x** installed and available on your PATH.

**This version of Session Keeper supports OpenCode 2.x only. OpenCode 1.x and older are not supported** and may fail to connect or discover the database.

Before connecting, check your installed version:

```sh
opencode --version
```

If it reports a version older than 2.x, upgrade to OpenCode 2, restart Session Keeper, and connect again.

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:4173>. Select **Connect to OpenCode** to discover or start the local OpenCode service. The dashboard listens on loopback only; it is not intended to be exposed to a network.

The frontend is Angular with standalone components. Each component keeps its template in a matching `.html` file. Signals hold UI state and computed values; `httpResource` drives reactive GET requests for sessions, projects, content search, and cleanup previews. `SessionApiService` uses `HttpClient` for mutations, while `SessionPreferencesService` stores the retention setting.

For a production build:

```sh
npm run build
npm start
```

Run the unit tests with:

```sh
npm test
```

## Current features

- List and filter sessions across projects, including archived sessions.
- Restore the connected view after a page refresh while the local backend still has a healthy OpenCode connection.
- Show the total conversation count and on-disk database footprint (database file plus SQLite WAL, when present).
- Search session titles using OpenCode's session API.
- Search user prompts and assistant replies across the selected conversations. The search scans message history on demand, so large histories can take time; if a conversation cannot be read, it reports that results may be incomplete. Reasoning and tool output are not searched.
- Delete a session after confirmation. OpenCode also deletes its child sessions; the dashboard shows the cascade count and prevents deletion if the session or a child is active.
- Review conversations older than a configurable number of days (30 by default). Cleanup is manual, lists every eligible conversation, protects active/newer descendants, and asks for confirmation before deleting.
- Show a quick post-cleanup database-size estimate based on the current database and WAL file sizes. SQLite usually reuses freed pages, so the on-disk database will likely remain around its current size after deletion.
- Compact the SQLite database from an explicit maintenance button with a visible step list. The synchronous SQLite `VACUUM` stage shows an indeterminate spinner rather than a percentage. The app refuses while OpenCode reports active sessions, asks before stopping/restarting the shared service, creates a private backup, checks database integrity and conversation count, and reports before/after sizes. Verified backups can be deleted from the dashboard after review; unverified backups are retained for recovery.

No search index or session cache is copied into a separate database. Database-size displays use filesystem metadata only. Session listing, message search, and deletion use the official `@opencode/client` API. Content search reads conversation messages only when requested. Compaction is the only feature that opens and rewrites the SQLite database; it requires explicit confirmation and retains a backup until you delete it in the dashboard. Nothing is deleted automatically.

OpenCode's default database location is `~/.local/share/opencode/opencode.db`. If OpenCode uses a custom `OPENCODE_DB` path, start this app with the same absolute `OPENCODE_DB` value so the size display can find it.

The server code is organized by responsibility:

- `server/index.ts` starts the local HTTP server; `server/http/app.ts` configures Express and wires route modules from `server/http/routes/`.
- `server/services/` contains named use cases and the shared OpenCode client.
- `server/data/` contains reusable session listing, search, cleanup-planning, and database-metadata logic used by the HTTP routes.

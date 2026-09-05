# Universal Dashboard

Universal Dashboard is a private, local-first calendar for coursework, student organizations, and campus life. It is built with Next.js 16, React 19, Tailwind CSS 4, TypeScript, and Supabase.

## Privacy model

Calendar data is saved locally first using IndexedDB, with a localStorage fallback. After Google sign-in, tasks, events, subtasks, category colors, and calendar view preferences are backed up to the user's private Supabase rows when they sign in, reconnect, request a manual backup, and every three hours.

Signed-in users can recover their cloud-backed calendar after clearing browser site data by signing in again. **Backup details** shows the latest successful cloud backup, the local item count, and a manual retry control. Signed-out users should download JSON backups regularly with **Export data** and restore them through **Classes → Import syllabus → JSON backup**.

JSON backups are versioned and include every category, task, event, subtask, calendar color, calendar view, and category workspace view. Restoring merges by stable item identity, keeps newer local changes, and does not erase the existing calendar. Legacy task-array backups remain supported.

Supabase provides authentication and the RLS-protected cloud schema. Every query is additionally checked against the signed-in user ID by Postgres Row Level Security. Deletes are synchronized as recoverable tombstones rather than hard-deleting rows from browser clients. The publishable key is safe for the browser because it cannot bypass RLS. The Supabase secret key and database URL are server-only and must never be prefixed with `NEXT_PUBLIC_` or exposed to browser code.

A browser calendar is bound to the first Google account used to back it up. If a different Google account signs in on that browser, synchronization stops instead of mixing the two users' data.

## Features

- Month and expanded week calendar views.
- Classes, organizations, and social workspaces.
- Tasks and events with alternate display styles.
- Subtasks with independent completion.
- Recurring semester schedules.
- Read-first event details and quick task completion.
- Classes-only syllabus import from pasted text or selectable-text PDFs.
- Canvas feed preview, deduplication, and local sync.
- Google Calendar ZIP and ICS import processed entirely in the browser.
- JSON backup export and restore.
- Google sign-in with private, automatic cross-device cloud backup.
- Optional Texas Athletics home-event browser.

## Run locally

Requirements:

- Node.js 22 or newer
- pnpm 11

Install and run:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.local.example` to `.env.local`. The application requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. `SUPABASE_SECRET_KEY` and `DATABASE_URL` are optional server-only maintenance credentials and are not used by browser synchronization. Never commit `.env.local`.

## Google sign-in setup

1. In Google Cloud, create a Web application OAuth client.
2. Add `http://localhost:3000` and `https://universaldashboard.vercel.app` as authorized JavaScript origins.
3. Add `https://secktcintxjrvvpaiheg.supabase.co/auth/v1/callback` as the authorized redirect URI.
4. In **Supabase → Authentication → Providers → Google**, enable Google and paste the OAuth client ID and secret.
5. In **Supabase → Authentication → URL Configuration**, set the site URL to `https://universaldashboard.vercel.app` and allow `http://localhost:3000/auth/callback` plus `https://universaldashboard.vercel.app/auth/callback` as redirects.

The application requests only basic Google identity information. Google Calendar access is not requested during sign-in; calendar migration remains a user-directed ZIP/ICS import. Synchronization retries after local changes, when connectivity returns, when the app regains focus, and on a short safety interval.

## Verification

Run all required checks before deployment:

```bash
pnpm typecheck
pnpm lint
pnpm verify-ical-sync
pnpm verify-feed-lookup
pnpm verify-google-import
pnpm verify-cloud-sync
pnpm verify-backup
pnpm verify-release
pnpm verify-stage4
pnpm build
```

`verify-release` checks the two required browser-safe environment variables, reports whether optional server maintenance credentials are present, confirms Google authentication is enabled, and verifies anonymous calendar reads are denied. It never prints key values. Follow [DEPLOYMENT.md](./DEPLOYMENT.md) when moving existing browser-only users to cloud backup.

## Google Calendar migration

In Google Calendar on a computer, open **Settings → Import & export → Export**. Google downloads a ZIP containing one ICS file per calendar. In Universal Dashboard, select **Import Google Calendar** and choose the ZIP directly; manual extraction is not required.

The importer previews events, allows a destination category, skips previously imported calendar identifiers, and writes selected events only to the current browser.

Recurring Google events are expanded from one year in the past through two years in the future so calendars with open-ended recurrence rules remain bounded.

## Vercel deployment

Import the GitHub repository as a new Vercel project and use the standard Next.js settings. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to Preview and Production. Server-only workflows may also use `SUPABASE_SECRET_KEY` and `DATABASE_URL`; never expose either value to the browser. The default commands from `package.json` are sufficient.

Each Vercel domain has its own browser storage origin. A calendar created on a preview URL will not automatically appear on the production domain; export a JSON backup from the preview and restore it on production when needed.

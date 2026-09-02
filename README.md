# Universal Dashboard

Universal Dashboard is a private, device-first calendar for coursework, student organizations, and campus life. It is built with Next.js 16, React 19, Tailwind CSS 4, and TypeScript.

## Privacy model

Calendar data is stored in the visitor's browser using IndexedDB, with a localStorage fallback. There are no accounts and no shared application database. Different browsers, browser profiles, and devices have independent calendars.

Clearing browser site data can erase the local calendar. Users should download JSON backups regularly with **Export data** and restore them through **Classes → Import syllabus → JSON backup**.

Universal Dashboard does not require Supabase or any environment variables. The only server endpoint is a restricted calendar-feed reader used to retrieve and parse a user-supplied Canvas iCalendar URL. The endpoint does not write calendar data, and approved changes are saved by the browser locally.

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

No `.env.local` file is required.

## Verification

Run all required checks before deployment:

```bash
pnpm typecheck
pnpm lint
pnpm verify-ical-sync
pnpm verify-google-import
pnpm verify-stage4
pnpm build
```

## Google Calendar migration

In Google Calendar on a computer, open **Settings → Import & export → Export**. Google downloads a ZIP containing one ICS file per calendar. In Universal Dashboard, select **Import Google Calendar** and choose the ZIP directly; manual extraction is not required.

The importer previews events, allows a destination category, skips previously imported calendar identifiers, and writes selected events only to the current browser.

Recurring Google events are expanded from one year in the past through two years in the future so calendars with open-ended recurrence rules remain bounded.

## Vercel deployment

Import the GitHub repository as a new Vercel project and use the standard Next.js settings. Do not add Supabase integrations or environment variables. The default commands from `package.json` are sufficient.

Each Vercel domain has its own browser storage origin. A calendar created on a preview URL will not automatically appear on the production domain; export a JSON backup from the preview and restore it on production when needed.

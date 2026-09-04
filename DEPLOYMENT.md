# Universal Dashboard rollout

This checklist protects calendars that already exist only in users' browsers while cloud accounts are introduced.

## Before the deployment

1. Keep the current production site available while users prepare.
2. Ask each existing user to open **Export data**, confirm, and retain the downloaded JSON backup.
3. Confirm the Universal Dashboard Vercel project has `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in both Preview and Production. Keep `SUPABASE_SECRET_KEY` and `DATABASE_URL` server-only; they are not required by browser sync.
4. Run `pnpm verify-release` and the full verification commands in the README.

## Deployment window

1. Pause the production site only when the final branch is ready to merge.
2. Commit and push the reviewed branch in Step 6 so Vercel builds the production deployment.
3. Check the production deployment before unpausing it: home page, Google sign-in redirect, calendar load, one test task, and **Backup details**.
4. Unpause the site after the checks pass.

## Existing-user migration

Each existing user must do this on the same browser and Vercel URL where their calendar currently appears:

1. Open Universal Dashboard. Do not clear browser data first.
2. Download one final JSON backup.
3. Select **Sign in with Google**.
4. Keep the page open until **Your existing calendar is backed up** appears.
5. Open **Backup details** and confirm that the latest backup has a completion time.
6. Optionally sign in on a second device to confirm the calendar is recovered there.

If an existing user's calendar is missing before sign-in, stop. Restore their JSON file through **Classes → Import syllabus → JSON backup**, then sign in and wait for the successful backup confirmation.

## Post-deployment checks

1. Confirm each expected person appears in Supabase Authentication users after signing in.
2. Confirm calendar row counts rise only after those users complete their first backup.
3. Run the Supabase RLS tests and security/performance advisors.
4. Keep the pre-deployment Vercel deployment available for rollback until every existing user confirms recovery.

Never request or collect a user's Google password, exported calendar, or JSON backup. Users complete sign-in and retain backup files themselves.

import assert from "node:assert/strict";

const browserRequired = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;
const maintenanceOnly = ["SUPABASE_SECRET_KEY", "DATABASE_URL"] as const;

function pass(message: string) {
  console.log(`PASS ${message}`);
}

async function main() {
  for (const name of browserRequired) {
    assert.ok(process.env[name]?.trim(), `${name} is missing or empty.`);
    pass(`${name}: set`);
  }
  for (const name of maintenanceOnly) {
    console.log(`${process.env[name]?.trim() ? "PASS" : "SKIP"} ${name}: ${process.env[name]?.trim() ? "set" : "not required by the deployed browser app"}`);
  }

  const projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  assert.equal(projectUrl.protocol, "https:", "NEXT_PUBLIC_SUPABASE_URL must use HTTPS.");
  assert.ok(projectUrl.hostname.endsWith(".supabase.co"), "NEXT_PUBLIC_SUPABASE_URL is not a Supabase project URL.");
  pass("Supabase project URL: valid HTTPS project URL");

  const headers = {
    apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!}`,
  };
  const authResponse = await fetch(new URL("/auth/v1/settings", projectUrl), { headers });
  assert.equal(authResponse.ok, true, `Supabase Auth settings returned HTTP ${authResponse.status}.`);
  const authSettings = await authResponse.json() as { external?: { google?: boolean } };
  assert.equal(authSettings.external?.google, true, "Google sign-in is not enabled in this Supabase project.");
  pass("Supabase Auth: reachable and Google provider enabled");

  const anonymousRead = await fetch(new URL("/rest/v1/calendar_items?select=id&limit=1", projectUrl), { headers });
  assert.ok(anonymousRead.status === 401 || anonymousRead.status === 403, `Anonymous calendar read unexpectedly returned HTTP ${anonymousRead.status}.`);
  pass("Anonymous calendar access: denied by database security");

  console.log("PASS Release readiness checks completed without printing any key values.");
}

void main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : "Release readiness check failed."}`);
  process.exitCode = 1;
});

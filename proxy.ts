import { NextResponse, type NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";

const PUBLIC_HOST = "universaldashboard.vercel.app";
const PROTECTED_VERCEL_HOSTS = new Set(["universaldashboard-in-7257.vercel.app"]);

export async function proxy(request: NextRequest) {
  if (PROTECTED_VERCEL_HOSTS.has(request.nextUrl.hostname)) {
    const publicUrl = request.nextUrl.clone();
    publicUrl.protocol = "https:";
    publicUrl.hostname = PUBLIC_HOST;
    publicUrl.port = "";
    return NextResponse.redirect(publicUrl);
  }

  const authorizationCode = request.nextUrl.searchParams.get("code");
  if (request.nextUrl.pathname === "/" && authorizationCode) {
    const callbackUrl = request.nextUrl.clone();
    callbackUrl.pathname = "/auth/callback";
    callbackUrl.search = "";
    callbackUrl.searchParams.set("code", authorizationCode);
    callbackUrl.searchParams.set("next", "/");
    return NextResponse.redirect(callbackUrl);
  }

  return refreshSupabaseSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

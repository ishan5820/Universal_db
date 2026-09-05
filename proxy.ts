import { NextResponse, type NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
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

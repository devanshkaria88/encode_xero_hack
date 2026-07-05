import { NextRequest, NextResponse } from "next/server";

// Mirrors the redirect URI registered in Google Cloud Console
// (http://localhost:3000/api/v1/calendar-providers/google/callback) so the
// existing OAuth app works without console changes. Google lands here; we
// forward the code to the Robyn API server-side, then bounce to Connections.
const API_BASE = process.env.API_INTERNAL_BASE ?? "http://localhost:4000";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const dest = new URL("/connections", url.origin);

  if (error || !code) {
    dest.searchParams.set("google", "error");
    dest.searchParams.set("reason", error ?? "missing_code");
    return NextResponse.redirect(dest);
  }

  try {
    const api = new URL("/api/google/callback", API_BASE);
    api.searchParams.set("code", code);
    if (state) api.searchParams.set("state", state);
    const res = await fetch(api, { cache: "no-store" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      dest.searchParams.set("google", "error");
      dest.searchParams.set(
        "reason",
        body.slice(0, 200) || `api_${res.status}`,
      );
      return NextResponse.redirect(dest);
    }
    dest.searchParams.set("google", "connected");
    return NextResponse.redirect(dest);
  } catch {
    dest.searchParams.set("google", "error");
    dest.searchParams.set("reason", "api_unreachable");
    return NextResponse.redirect(dest);
  }
}

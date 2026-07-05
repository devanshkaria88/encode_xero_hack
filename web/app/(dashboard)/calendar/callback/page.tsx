"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { get } from "@/lib/api";

/**
 * Google's OAuth redirect lands here (the registered redirect URI is
 * http://localhost:3001/calendar/callback). This page only ferries the
 * authorisation code to the API, which exchanges it for tokens server-side,
 * then bounces to the Connections page. Mirrors the reference stack's
 * frontend-callback / backend-authorises flow.
 */
function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const ran = React.useRef(false);

  React.useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const error = params.get("error");
    const code = params.get("code");
    const state = params.get("state");

    const bounce = (query: string) => router.replace(`/connections?${query}`);

    if (error || !code) {
      bounce(`google=error&reason=${encodeURIComponent(error ?? "missing_code")}`);
      return;
    }

    const qs = new URLSearchParams({ code });
    if (state) qs.set("state", state);
    get(`/google/callback?${qs.toString()}`)
      .then(() => bounce("google=connected"))
      .catch((err: unknown) => {
        const reason =
          err instanceof Error && err.message ? err.message : "exchange_failed";
        bounce(`google=error&reason=${encodeURIComponent(reason.slice(0, 200))}`);
      });
  }, [params, router]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      <p className="text-sm">Connecting your Google account...</p>
    </div>
  );
}

export default function GoogleCallbackPage() {
  return (
    <React.Suspense fallback={null}>
      <CallbackInner />
    </React.Suspense>
  );
}

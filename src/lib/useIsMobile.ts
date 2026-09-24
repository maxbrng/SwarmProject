"use client";

import { useSyncExternalStore } from "react";

// Same breakpoint as the mobile block in globals.css — the phone-only chrome behaviour (idle fade,
// swipe-to-hide, compact readout) is driven from React, so both sides must agree on what "mobile"
// means. useSyncExternalStore keeps this SSR-safe: the server snapshot is always false, so the first
// client render matches the server and the real value arrives on subscription.
const MOBILE_QUERY = "(max-width: 600px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

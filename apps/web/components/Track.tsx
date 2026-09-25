"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/*
 * The browser's half of the counting.
 *
 * A session is a random number this makes up and keeps in `sessionStorage`: it lives
 * for one tab, it is never a cookie, it is never sent to another site, and two visits
 * by the same person are two unrelated sessions. It is enough to ask "what did one
 * visit do" and not enough to build a profile.
 *
 * Events are batched and sent with `sendBeacon` where it exists, which is the one way
 * to report the last thing a visit did without holding the page open to do it. Nothing
 * here is awaited and nothing can fail loudly: a counter must never be the reason a
 * page is slow or a console is red.
 */

const KEY = "keystone-session";
const queue: { name: string; label?: string }[] = [];
let scheduled: ReturnType<typeof setTimeout> | null = null;

function session(): string {
  if (typeof window === "undefined") return "anon";
  try {
    const found = window.sessionStorage.getItem(KEY);
    if (found) return found;
    const made = Math.random().toString(36).slice(2, 14);
    window.sessionStorage.setItem(KEY, made);
    return made;
  } catch {
    // Storage refused — a private window, or a browser with it switched off. The
    // events still count; they simply do not group into a visit.
    return "anon";
  }
}

function flush(): void {
  if (queue.length === 0) return;
  const payload = JSON.stringify({
    events: queue.splice(0, queue.length),
    session: session(),
    referrer: document.referrer || undefined,
  });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
      return;
    }
    void fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nothing here is worth a broken page.
  }
}

/** Note that something happened. Safe to call from anywhere, including a render path. */
export function track(name: string, label?: string): void {
  if (typeof window === "undefined") return;
  queue.push({ name, label });
  if (scheduled) return;
  // Batched, so a burst of events is one request. Short enough that a visitor who
  // leaves immediately is still counted, via the unload flush below.
  scheduled = setTimeout(() => {
    scheduled = null;
    flush();
  }, 1200);
}

/** Mounted once in the layout: counts page views and sees visits out. */
export function Track() {
  const path = usePathname();

  useEffect(() => {
    if (!path) return;
    // The route, not the URL. `/paper/1706.03762` is counted as `/paper/[id]` with
    // the identifier as its own label, so the page list stays readable and no query
    // string is ever recorded.
    const route = path.startsWith("/paper/") ? "/paper/[id]" : path;
    track("view", route);
    if (path.startsWith("/paper/")) {
      const id = path.slice("/paper/".length);
      if (/^[\w.\/-]{5,30}$/.test(id)) track("paper.open", id);
    }
  }, [path]);

  useEffect(() => {
    const leave = () => flush();
    // `visibilitychange` rather than `unload`, which modern browsers may never fire.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") leave();
    });
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);

  return null;
}

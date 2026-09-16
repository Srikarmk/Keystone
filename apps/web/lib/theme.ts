"use client";

/*
 * Reading the current theme from the one place that already knows it.
 *
 * The theme is set on <html> before paint by an inline script and toggled by
 * ThemeToggle, so the DOM is the source of truth — not React state. A context provider
 * would mean two sources that can disagree, and the one set before hydration would
 * win on first paint and lose afterwards.
 *
 * Starts false and corrects in an effect, deliberately: returning the real value
 * during render would make the server and the client disagree about the markup.
 */

import { useEffect, useState } from "react";

export function useIsDark(): boolean {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return dark;
}

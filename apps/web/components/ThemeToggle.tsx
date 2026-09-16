"use client";

/*
 * Theme selection, persisted.
 *
 * Starts from the system preference and only pins a choice once the reader makes
 * one, so the default is whatever their machine already says rather than ours.
 */

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "keystone-theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    const system: Theme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
    setTheme(stored ?? system);
  }, []);

  useEffect(() => {
    if (!theme) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  if (!theme) return null;

  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => {
        window.localStorage.setItem(STORAGE_KEY, next);
        setTheme(next);
      }}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className="text-[0.78rem] italic text-ink-faint transition-colors hover:text-brass"
    >
      {theme === "dark" ? "light" : "dark"}
    </button>
  );
}

"use client";

import { MotionConfig } from "motion/react";

/*
 * Every motion on the site defers to the reader's reduced-motion setting.
 *
 * The CSS animations already had `prefers-reduced-motion` rules; the ones driven by
 * motion/react did not, so the library rows and the graph still slid in for a reader
 * who had asked the system for stillness. "user" keeps opacity and drops the travel.
 */
export function Motion({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

"use client";

/*
 * A collapsible section of the analysis.
 *
 * The reader used to be eight tabs in a 30rem column, which clipped mid-word and
 * needed a horizontal scrollbar. Tabs were the wrong shape for this: the analysis is a
 * report, not eight peer views, and a report is something you scroll with the parts
 * you do not need folded away.
 */

import { motion, AnimatePresence } from "motion/react";
import { useEffect, useState } from "react";

export function Section({
  title,
  count,
  subtitle,
  defaultOpen = false,
  anchors,
  children,
}: {
  title: string;
  count?: number;
  subtitle?: string;
  defaultOpen?: boolean;
  /** Row ids this section contains, so a link to one of them can open it. */
  anchors?: string[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const empty = count === 0;

  // A closed section does not render its children at all, so a link to a row inside
  // one lands on nothing. The section has to recognise its own rows and open.
  useEffect(() => {
    if (!anchors?.length) return;
    const check = () => {
      const target = window.location.hash.slice(1);
      if (target && anchors.includes(target)) setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [anchors]);

  return (
    <section className="border-b border-paper-edge/70">
      <h2>
        <button
          type="button"
          onClick={() => !empty && setOpen((v) => !v)}
          aria-expanded={open}
          disabled={empty}
          className="group flex w-full items-baseline gap-3 py-3.5 text-left disabled:cursor-default"
        >
          <span
            aria-hidden
            className="w-3 shrink-0 text-[0.7rem] text-ink-faint transition-transform"
            style={{ transform: open ? "rotate(90deg)" : "none" }}
          >
            {empty ? "·" : "›"}
          </span>
          <span
            className={`text-[1.02rem] transition-colors ${
              empty ? "text-ink-faint" : "text-ink group-hover:text-brass"
            }`}
          >
            {title}
          </span>
          {count !== undefined ? (
            <span className="numeral text-[0.8rem] text-ink-faint">{count}</span>
          ) : null}
          {subtitle ? (
            <span className="ml-auto truncate pl-3 text-[0.8rem] italic text-ink-faint">
              {subtitle}
            </span>
          ) : null}
        </button>
      </h2>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="pb-5 pl-6">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

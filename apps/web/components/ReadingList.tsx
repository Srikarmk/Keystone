"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { forget, summary, sync, visits, type Visit } from "@/lib/history";

/**
 * The papers this browser has opened.
 *
 * Read in an effect rather than during render, because local storage does not exist on
 * the server and reading it while rendering would make the server and client disagree.
 * The empty state is the common one for a first visit and is written for that.
 */
export function ReadingList() {
  const [list, setList] = useState<Visit[] | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let live = true;
    // Local first so the list is on screen immediately, then reconciled with the
    // account. A reader who is signed out never notices the second step happened.
    setList(visits());
    sync().then((result) => {
      if (!live) return;
      setList(result.visits);
      setSyncing(result.syncing);
    });
    return () => {
      live = false;
    };
  }, []);

  if (list === null) return <div className="mt-12 h-40" />;

  const counted = summary(list);

  return (
    <div className="mt-12 border-t border-paper-edge pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[1.15rem]">What you have read</h2>
        {list.length > 0 ? (
          <button
            type="button"
            onClick={async () => {
              setList([]);
              await forget();
            }}
            className="text-[0.8rem] italic text-ink-faint transition-colors hover:text-brass"
          >
            {syncing ? "forget it everywhere" : "forget all of it"}
          </button>
        ) : null}
      </div>

      {list.length === 0 ? (
        <p className="mt-3 max-w-2xl text-[0.92rem] leading-relaxed text-ink-soft">
          Nothing yet. Open a paper and it appears here.{" "}
          <Link href="/" className="text-brass transition-colors hover:text-ink">
            Start with the library
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="mt-2 text-[0.82rem] text-ink-faint">
            {syncing
              ? "Synced to your account, so this list follows you between machines."
              : "Kept in this browser only."}
          </p>
          <p className="numeral mt-1 text-[0.82rem] text-ink-faint">
            {counted.papers} paper{counted.papers === 1 ? "" : "s"}, opened{" "}
            {counted.opens} time{counted.opens === 1 ? "" : "s"}
            {counted.since
              ? `, since ${new Date(counted.since).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                })}`
              : null}
          </p>
          <ul className="mt-5 divide-y divide-paper-edge border-y border-paper-edge">
            {list.map((visit) => (
              <li key={visit.id}>
                <Link
                  href={`/paper/${visit.id}`}
                  className="group flex items-baseline justify-between gap-5 py-3 transition-colors hover:text-brass"
                >
                  <span className="text-[0.95rem]">{visit.title}</span>
                  <span className="numeral shrink-0 text-[0.78rem] text-ink-faint">
                    {visit.count > 1 ? `${visit.count}× · ` : ""}
                    {new Date(visit.at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

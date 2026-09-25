"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { AccountMenu } from "@/components/AccountMenu";
import { Search } from "@/components/Search";
import { ThemeToggle } from "@/components/ThemeToggle";

/*
 * One header for every page that is not the reader.
 *
 * The reader keeps its own masthead, because there the paper picker is the
 * navigation and a second row of links above it would be two answers to the same
 * question.
 *
 * The nav is here rather than only in the footer because the library-wide views are
 * the part of this site nobody would guess exists: the front page looks like a list
 * of papers, and "which papers disagree with each other" is not a question a list of
 * papers invites. A link at the top is the difference between a feature and a
 * feature somebody finds.
 */

const NAV = [
  { href: "/timeline", label: "in order" },
  { href: "/contested", label: "disagreements" },
  { href: "/assumptions", label: "taken on faith" },
  { href: "/method", label: "how it reads" },
];

export function SiteHeader() {
  const here = usePathname();

  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-paper-edge py-5">
      <span className="flex items-baseline gap-6">
        <Link href="/" className="pressed text-[1.4rem] leading-none transition-colors hover:text-brass">
          Keystone
        </Link>
        <nav className="flex items-baseline gap-5">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`text-[0.82rem] transition-colors ${
                here === item.href
                  ? "border-b border-brass pb-0.5 text-brass"
                  : "text-ink-faint hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </span>
      <span className="flex items-center gap-5">
        <Search />
        <ThemeToggle />
        <AccountMenu />
        <a
          href="https://github.com/Srikarmk/Keystone"
          className="text-[0.8rem] italic text-ink-soft transition-colors hover:text-brass"
        >
          source
        </a>
      </span>
    </header>
  );
}

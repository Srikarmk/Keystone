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
  { href: "/news", label: "what's new" },
  { href: "/timeline", label: "in order" },
  { href: "/contested", label: "disagreements" },
  { href: "/assumptions", label: "taken on faith" },
  { href: "/method", label: "how it reads" },
];

export function SiteHeader() {
  const here = usePathname();

  const links = NAV.map((item) => {
    const current = here === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={current ? "page" : undefined}
        className={`whitespace-nowrap text-[0.92rem] underline-offset-[6px] transition-colors ${
          current
            ? "text-ink underline decoration-brass decoration-1"
            : "text-ink-soft hover:text-ink"
        }`}
      >
        {item.label}
      </Link>
    );
  });

  return (
    <header className="border-b border-paper-edge py-5">
      <div className="flex items-center justify-between gap-6">
        <div className="flex min-w-0 items-baseline gap-8">
          <Link
            href="/"
            className="pressed text-[1.55rem] leading-none tracking-[-0.01em] transition-colors hover:text-brass"
          >
            Keystone
          </Link>
          <nav aria-label="Library views" className="hidden items-baseline gap-6 md:flex">
            {links}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-5">
          <Search />
          <ThemeToggle />
          <AccountMenu />
          <a
            href="https://github.com/Srikarmk/Keystone"
            className="hidden text-[0.85rem] italic text-ink-soft transition-colors hover:text-brass sm:inline"
          >
            source
          </a>
        </div>
      </div>
      {/* On a phone the five views get a row of their own that scrolls sideways. Wrapped
          beside the wordmark they broke "taken on faith" over three lines and pushed
          the page off centre. */}
      <nav
        aria-label="Library views"
        className="-mx-6 mt-4 flex gap-6 overflow-x-auto px-6 pb-1 [scrollbar-width:none] md:hidden [&::-webkit-scrollbar]:hidden"
      >
        {links}
      </nav>
    </header>
  );
}

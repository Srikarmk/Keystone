"use client";

import { useState } from "react";

import { rowUrl } from "@/lib/rows";

/**
 * Copy a link to one reading.
 *
 * Deliberately quiet: it appears on hover or focus and takes no space otherwise,
 * because the row's job is to be read and this is for the moment somebody wants to
 * argue with it. Keyboard users get it permanently on focus rather than never.
 */
export function RowLink({ id, what }: { id: string; what: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        const url = rowUrl(id);
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          // Clipboard refused — an insecure origin, or permission denied. Putting
          // the fragment in the address bar still lets them copy it by hand, which
          // is better than a button that appears to do nothing.
          window.location.hash = id;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      title={`Copy a link to this ${what}`}
      aria-label={`Copy a link to this ${what}`}
      className="opacity-0 transition-[color,opacity] hover:text-brass focus-visible:opacity-100 group-hover/row:opacity-100"
    >
      {copied ? <span className="text-brass">link copied</span> : "link"}
    </button>
  );
}

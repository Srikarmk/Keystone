import type { Metadata } from "next";

/*
 * Metadata for a client page.
 *
 * The page itself has to be a client component — it reads the library index in the
 * browser and filters it as you click. A client component cannot export `metadata`,
 * so it lives in a layout beside it. Without this the page inherits the site title
 * and a link shared to it says "what is this paper standing on?", which is a
 * different question from the one the page answers.
 */
export const metadata: Metadata = {
  title: "Where the library argues with itself",
  description:
    "Every sentence in the library where a paper says prior work is wrong, or " +
    "measures itself against it — quoted as written, with the words that decided it.",
  openGraph: {
    title: "Where the library argues with itself — Keystone",
    description:
      "Every sentence where a paper says prior work is wrong, quoted as written.",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

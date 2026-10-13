import Link from "next/link";

import { Footer } from "@/components/Footer";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata = { title: "Not found", robots: { index: false } };

/**
 * A page that does not exist, in the site's own voice.
 *
 * Mostly reached by a URL that cannot be a paper. It says how to get a real one
 * rather than only that this is not it: the reader takes any arXiv id, so the useful
 * answer to a mistyped link is the shape of a working one.
 */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-[1180px] px-6 pb-24 lg:px-10">
      <header className="flex items-center justify-between border-b border-paper-edge py-5">
        <Link href="/" className="pressed text-[1.4rem] leading-none">
          Keystone
        </Link>
        <ThemeToggle />
      </header>

      <section className="mx-auto max-w-lg pt-16">
        <h1 className="pressed text-[2rem] leading-[1.1] tracking-[-0.02em]">
          Nothing here
        </h1>
        <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
          There is no page at this address. A paper lives at its arXiv id &mdash;{" "}
          <Link href="/paper/1706.03762" className="text-brass underline decoration-brass/40 underline-offset-2 transition-colors hover:decoration-brass">
            /paper/1706.03762
          </Link>{" "}
          &mdash; and any paper on arXiv that ships its LaTeX source can be read that
          way, not only the ones in the library.
        </p>
        <p className="mt-6 text-[0.95rem]">
          <Link href="/" className="text-brass underline decoration-brass/40 underline-offset-2 transition-colors hover:decoration-brass">
            Back to the library
          </Link>
        </p>
      </section>

      <Footer />
    </main>
  );
}

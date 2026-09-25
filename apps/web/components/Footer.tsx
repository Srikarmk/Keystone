import Link from "next/link";

/*
 * The site's footer.
 *
 * Two jobs. The first is navigation: the library-wide pages have no other way in
 * from a paper, and a reader who has just followed six citations should not have to
 * go back to the home page to find out where else they can go.
 *
 * The second is the caveat, and it belongs at the bottom of every page rather than
 * only on the front one. The whole claim of this project is that it says what it
 * does not know; a reader who arrives on a paper page from a shared link has seen
 * none of that, and "a citation with no stance is one where the prose made nothing
 * checkable, not one that does not matter" is exactly the sentence that stops the
 * empty rows being read as a verdict.
 */

const READING: { href: string; label: string; hint: string }[] = [
  { href: "/", label: "The library", hint: "every paper analysed" },
  { href: "/timeline", label: "In order", hint: "the papers on a time axis" },
  { href: "/contested", label: "Disagreements", hint: "where papers say prior work is wrong" },
  { href: "/assumptions", label: "Taken on faith", hint: "what is asserted with nothing behind it" },
];

const ABOUT: { href: string; label: string; hint: string; external?: boolean }[] = [
  { href: "/method", label: "How it reads", hint: "the rules, and how often they are wrong" },
  { href: "/profile", label: "Your account", hint: "reading list, highlights and notes" },
  {
    href: "https://github.com/Srikarmk/Keystone",
    label: "Source",
    hint: "the parser and the site",
    external: true,
  },
];

export function Footer({ papers }: { papers?: number }) {
  return (
    <footer className="mt-20 border-t border-paper-edge pt-9">
      <div className="grid gap-9 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <span className="pressed text-[1.25rem] leading-none">Keystone</span>
          <p className="mt-3 max-w-xs text-[0.86rem] leading-relaxed text-ink-soft">
            What a paper adopts, what it argues with, and what it takes on faith &mdash;
            read out of its own LaTeX and pinned to the page that says it.
          </p>
          {papers ? (
            <p className="numeral mt-3 text-[0.76rem] text-ink-faint">
              {papers} papers analysed
            </p>
          ) : null}
        </div>

        <Column title="Read" links={READING} />
        <Column title="About" links={ABOUT} />
      </div>

      <p className="mt-10 max-w-2xl border-t border-paper-edge pt-6 text-[0.8rem] leading-relaxed text-ink-faint">
        Keystone reports what a paper says about other papers and about its own
        assumptions, in the paper&rsquo;s own words. It does not judge whether the idea
        is good, and a citation it says nothing about is one where the prose made
        nothing checkable &mdash; not one that does not matter. Analysis covers arXiv
        papers that ship LaTeX source; roughly one in ten does not.
      </p>
    </footer>
  );
}

function Column({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string; hint: string; external?: boolean }[];
}) {
  return (
    <div>
      <h2 className="text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint">
        {title}
      </h2>
      <ul className="mt-3 space-y-2.5">
        {links.map((link) => (
          <li key={link.href}>
            {link.external ? (
              <a
                href={link.href}
                className="group block"
                target="_blank"
                rel="noreferrer"
              >
                <Label {...link} />
              </a>
            ) : (
              <Link href={link.href} className="group block">
                <Label {...link} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Label({ label, hint }: { label: string; hint: string }) {
  return (
    <>
      <span className="block text-[0.92rem] leading-snug transition-colors group-hover:text-brass">
        {label}
      </span>
      <span className="block text-[0.78rem] leading-snug text-ink-faint">{hint}</span>
    </>
  );
}

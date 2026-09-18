import Link from "next/link";

import { availableProviders, currentUser, signOut } from "@/auth";
import { ReadingList } from "@/components/ReadingList";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata = { title: "Profile — Keystone" };

/**
 * Who you are, if you said, and what you have read either way.
 *
 * A guest sees the same reading list a signed-in visitor does, because the list has
 * always been local and signing in does not move it. The only difference is a name at
 * the top, and the page says so rather than implying an account that syncs.
 */
export default async function Profile() {
  const user = await currentUser();
  const canSignIn = availableProviders().length > 0;

  return (
    <main className="mx-auto max-w-[1180px] px-6 pb-24 lg:px-10">
      <header className="flex items-center justify-between border-b border-paper-edge py-5">
        <Link href="/" className="pressed text-[1.4rem] leading-none">
          Keystone
        </Link>
        <span className="flex items-center gap-5">
          <ThemeToggle />
          <Link
            href="/"
            className="text-[0.8rem] italic text-ink-soft transition-colors hover:text-brass"
          >
            library
          </Link>
        </span>
      </header>

      <section className="pt-12">
        <div className="flex flex-wrap items-center gap-5">
          {user?.image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={user.image}
              alt=""
              width={64}
              height={64}
              className="h-16 w-16 border border-paper-edge object-cover"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-16 w-16 items-center justify-center border border-paper-edge bg-paper-deep text-[1.5rem] text-ink-faint"
            >
              &mdash;
            </span>
          )}
          <div>
            <h1 className="pressed text-[2rem] leading-[1.1] tracking-[-0.02em]">
              {user?.name ?? "Reading as a guest"}
            </h1>
            <p className="mt-1.5 text-[0.88rem] text-ink-faint">
              {user ? (
                <>
                  {user.email ?? "no address shared"}
                  {(user as { provider?: string }).provider
                    ? ` · via ${(user as { provider?: string }).provider}`
                    : null}
                </>
              ) : (
                "No account. Nothing about you is stored anywhere but this browser."
              )}
            </p>
          </div>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-6">
          {user ? (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="border-b border-paper-edge pb-1 text-[0.95rem] text-ink-soft transition-colors hover:border-brass hover:text-brass"
              >
                Sign out
              </button>
            </form>
          ) : canSignIn ? (
            <Link
              href="/signin"
              className="border-b border-brass pb-1 text-[1rem] text-brass transition-colors hover:text-ink"
            >
              Sign in &rarr;
            </Link>
          ) : null}
          <Link
            href="/"
            className="text-[0.95rem] text-ink-soft transition-colors hover:text-brass"
          >
            Open a paper
          </Link>
        </div>

        <ReadingList />

        <p className="mt-12 max-w-2xl border-t border-paper-edge pt-6 text-[0.82rem] leading-relaxed text-ink-faint">
          {user ? (
            <>
              Signed in, this list is kept on a server so it follows you between
              machines. What is stored is the arXiv id, title, date and count of each
              paper you opened, filed under a hash of your provider account id
              &mdash; not your name and not your address, so a row on its own does not
              say whose it is. &ldquo;Forget it everywhere&rdquo; above deletes it
              here and there, immediately and for good.
            </>
          ) : (
            <>
              As a guest nothing is stored anywhere but this browser, so the list
              cannot follow you to another machine and nobody, including me, can read
              it. Signing in trades that for a list that syncs.
            </>
          )}
        </p>
      </section>
    </main>
  );
}

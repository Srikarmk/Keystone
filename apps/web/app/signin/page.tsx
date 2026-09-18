import Link from "next/link";

import { availableProviders, signIn } from "@/auth";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata = { title: "Sign in — Keystone" };

const LABEL: Record<string, string> = { github: "GitHub", google: "Google" };

/**
 * Two doors, and the guest one is not the small print.
 *
 * Nothing in Keystone is behind this page. It exists so a returning visitor can carry
 * a name, and the page says plainly that it buys nothing else yet — a login that
 * implies a synced account it does not have is a worse lie than no login at all.
 */
export default async function SignIn() {
  const providers = availableProviders();

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
          You do not need an account
        </h1>
        <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
          Every paper, every citation reading and every assumption is open to anyone,
          and nothing here is behind this page. Signing in does one thing: your reading
          list follows you between machines instead of living in one browser. The cost
          is that it then lives on a server too &mdash; the papers you opened, filed
          under a hash of your account id, deletable from your profile in one click.
        </p>

        {providers.length > 0 ? (
          <div className="mt-8 flex flex-col gap-3">
            {providers.map((provider) => (
              <form
                key={provider}
                action={async () => {
                  "use server";
                  await signIn(provider, { redirectTo: "/profile" });
                }}
              >
                <button
                  type="submit"
                  className="w-full border border-paper-edge bg-paper-deep px-5 py-3 text-left text-[0.95rem] transition-colors hover:border-brass hover:text-brass"
                >
                  Continue with {LABEL[provider] ?? provider}
                </button>
              </form>
            ))}
          </div>
        ) : (
          /* Said out loud rather than shown as a dead button. Same discipline as the
             answering route's missing-key response: name what is absent. */
          <p className="mt-8 border border-paper-edge bg-paper-deep px-5 py-4 text-[0.88rem] leading-relaxed text-ink-faint">
            Sign-in is not configured on this deployment. It needs{" "}
            <span className="numeral">AUTH_SECRET</span> and one provider pair &mdash;{" "}
            <span className="numeral">AUTH_GITHUB_ID</span> /{" "}
            <span className="numeral">AUTH_GITHUB_SECRET</span> or{" "}
            <span className="numeral">AUTH_GOOGLE_ID</span> /{" "}
            <span className="numeral">AUTH_GOOGLE_SECRET</span>. Everything below works
            without it.
          </p>
        )}

        <div className="mt-8 border-t border-paper-edge pt-6">
          <Link
            href="/profile"
            className="border-b border-brass pb-1 text-[1rem] text-brass transition-colors hover:text-ink"
          >
            Continue as guest &rarr;
          </Link>
          <p className="mt-3 text-[0.82rem] leading-relaxed text-ink-faint">
            The whole library reads the same either way. A guest&rsquo;s reading list
            stays in this browser, which makes it useless on another machine and
            impossible for anyone else to read.
          </p>
        </div>

        <Link
          href="/"
          className="mt-10 inline-block text-[0.85rem] italic text-ink-faint transition-colors hover:text-brass"
        >
          &larr; back to the library
        </Link>
      </section>
    </main>
  );
}

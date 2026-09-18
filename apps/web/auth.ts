/*
 * Signing in, and not requiring it.
 *
 * Keystone is a reading tool, and everything it shows is a public paper quoted from a
 * public source. So an account buys you nothing you need to read a paper, and the
 * library is fully open to a guest — no page, no edge, no assumption is behind a login.
 * What an account is for is carrying your reading between machines, which needs a
 * server to keep it on and does not have one yet, so it is honestly labelled as such
 * rather than implied.
 *
 * Both providers are optional and independent. With neither configured, sign-in is not
 * offered at all rather than offered and broken, which is the same discipline the
 * answering route follows with its missing key: say what is absent, do not fail
 * mysteriously.
 */

import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";

/** Which providers the environment has credentials for. Empty is a valid state. */
function configured(): Provider[] {
  const out: Provider[] = [];
  if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
    out.push(
      GitHub({
        clientId: process.env.AUTH_GITHUB_ID,
        clientSecret: process.env.AUTH_GITHUB_SECRET,
      }),
    );
  }
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    out.push(
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
      }),
    );
  }
  return out;
}

/**
 * Names of the providers a visitor can actually use, for the UI to read.
 *
 * Server-side only. The sign-in page checks this before rendering a button, so an
 * unconfigured deployment never sends a request into NextAuth at all — which matters
 * because a missing `AUTH_SECRET` is a 500 rather than a graceful refusal.
 */
export function availableProviders(): ("github" | "google")[] {
  const out: ("github" | "google")[] = [];
  if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) out.push("github");
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) out.push("google");
  return process.env.AUTH_SECRET ? out : [];
}

/**
 * The signed-in user, or null — without ever throwing.
 *
 * `auth()` raises `MissingSecret` when `AUTH_SECRET` is absent, which on a site where
 * signing in is optional turns every page render into a logged error and a 500 risk.
 * Asking "is anyone signed in?" on an unconfigured deployment has an obvious answer,
 * so it is answered here instead of being raised.
 */
/**
 * The key a signed-in reader's history is filed under.
 *
 * A hash of the provider's account id rather than the id itself, and never the email.
 * The store then holds no value that identifies anybody on its own: with the database
 * in hand and no session, a row is an opaque hex string and a list of paper ids. That
 * is worth the one line it costs, because a reading list is a record of what somebody
 * was curious about, which is a more revealing thing than it first looks.
 */
export async function historyKey(): Promise<string | null> {
  const user = await currentUser();
  const raw = (user as { key?: string } | null)?.key;
  if (!raw) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`keystone:${raw}`),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export async function currentUser() {
  if (availableProviders().length === 0) return null;
  try {
    const session = await auth();
    return session?.user ?? null;
  } catch {
    return null;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: configured(),
  // No database. A signed cookie holds the name, avatar and provider and nothing else:
  // there is no reading history on a server to leak, because there is no server keeping
  // one. If that changes, this is the line that has to change with it.
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  trustHost: true,
  callbacks: {
    async jwt({ token, account }) {
      if (account?.provider) token.provider = account.provider;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const extended = session.user as { provider?: string; key?: string };
        extended.provider =
          typeof token.provider === "string" ? token.provider : undefined;
        // A stable, opaque handle for the reading history, derived from the
        // provider's own account id. Kept off the session's visible fields on
        // purpose — see `historyKey`.
        extended.key = typeof token.sub === "string" ? token.sub : undefined;
      }
      return session;
    },
  },
});

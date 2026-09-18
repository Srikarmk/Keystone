import { availableProviders, currentUser } from "@/auth";

/*
 * Who is signed in, for the header to read.
 *
 * A separate route rather than Auth.js's own session endpoint because this one cannot
 * fail. With no `AUTH_SECRET` configured, `auth()` throws, and the header asking "is
 * anyone signed in?" should get "no" rather than a 500 on every page of a site where
 * signing in is optional to begin with.
 */

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await currentUser();
    return Response.json({
      // Only what the header draws. The rest of the session stays on the server.
      user: user ? { name: user.name ?? null, image: user.image ?? null } : null,
      canSignIn: availableProviders().length > 0,
    });
  } catch {
    return Response.json({ user: null, canSignIn: false });
  }
}

/** @type {import('next').NextConfig} */

/*
 * The canonical origin, and everything else sent to it.
 *
 * `keystone-seven-beta.vercel.app` is the URL on a pitch that has already been
 * submitted, so it has to work — but it must not *serve* the site, only point at it.
 * Auth.js derives its OAuth callback from the host it was asked on, so signing in from
 * the old domain asks Google to return to a URI that is not registered, and Google
 * answers "Access blocked: this app's request is invalid". Two origins also means two
 * cookie jars and two sets of social cards for one site.
 *
 * So: one origin, and the old name is a redirect to it. 307 rather than 308, because a
 * permanent redirect is cached by browsers indefinitely and this is a decision worth
 * being able to change.
 */
const CANONICAL = "keystone-research.vercel.app";
const RETIRED = ["keystone-seven-beta.vercel.app"];

export default {
  reactStrictMode: true,
  async redirects() {
    return RETIRED.map((host) => ({
      source: "/:path*",
      has: [{ type: "host", value: host }],
      destination: `https://${CANONICAL}/:path*`,
      permanent: false,
    }));
  },
};

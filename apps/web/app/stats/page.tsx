import { currentUser } from "@/auth";
import { Footer } from "@/components/Footer";
import {
  RETAIN_DAYS,
  STREAM_DAYS,
  analyticsAvailable,
  commonPaths,
  funnel,
  readStats,
  readStream,
  sessionsOf,
  type DayStats,
} from "@/lib/analytics";

/*
 * What the site saw, for the person who runs it.
 *
 * Read on demand, per request, from whoever is asking — this is the definition of a
 * page that must never be prerendered.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Traffic" };

/**
 * Who may read this.
 *
 * An allowlist of addresses in `KEYSTONE_OWNER`, and with it unset nobody qualifies.
 * Refusing by default is the right way round: the failure then is a locked page with
 * instructions, and the failure the other way is everybody's numbers on the internet.
 */
function owners(): string[] {
  return (process.env.KEYSTONE_OWNER ?? "")
    .split(",")
    .map((one) => one.trim().toLowerCase())
    .filter(Boolean);
}

export default async function Stats() {
  const user = await currentUser();
  const allowed = owners();
  const email = (user?.email ?? "").toLowerCase();

  if (!user || allowed.length === 0 || !allowed.includes(email)) {
    return (
      <Locked
        signedIn={Boolean(user)}
        configured={allowed.length > 0}
        available={analyticsAvailable()}
      />
    );
  }

  const [days, steps] = await Promise.all([readStats(30), readStream(STREAM_DAYS)]);
  const sessions = sessionsOf(steps);
  const stages = ["view", "paper.open", "paper.ingest"];
  const reached = funnel(sessions, stages);
  const paths = commonPaths(sessions);
  const total = days.reduce(
    (sum, day) => sum + Object.values(day.events).reduce((n, v) => n + v, 0),
    0,
  );
  const people = days.reduce((sum, day) => sum + day.people, 0);

  return (
    <main className="mx-auto max-w-[1180px] px-6 pb-24 lg:px-10">
      <header className="flex items-baseline justify-between border-b border-paper-edge py-5">
        <span className="pressed text-[1.4rem] leading-none">Traffic</span>
        <span className="text-[0.8rem] italic text-ink-faint">{user.name}</span>
      </header>

      <section className="pt-9">
        <h1 className="pressed text-[2.2rem] leading-[1.12] tracking-[-0.02em]">
          What the site saw
        </h1>
        <p className="mt-4 max-w-2xl text-[0.95rem] leading-relaxed text-ink-soft">
          No cookie is set and no visitor is identified. People are counted with a
          probabilistic sketch of a daily, one-way hash, so the number is real and the
          hashes are not kept. Visits group into sessions only for the length of a
          browser tab.
        </p>
        <p className="numeral mt-3 text-[0.82rem] text-ink-faint">
          {people} people · {total} events · {days.length} day
          {days.length === 1 ? "" : "s"} recorded · kept {RETAIN_DAYS} days, journeys{" "}
          {STREAM_DAYS}
        </p>
      </section>

      {days.length === 0 ? (
        <p className="mt-10 text-[0.95rem] italic text-ink-faint">
          Nothing recorded yet. Open a page or two and come back.
        </p>
      ) : (
        <>
          <Trend days={days} />

          <div className="mt-14 grid gap-10 border-t border-paper-edge pt-9 sm:grid-cols-2">
            <Table title="Pages" rows={merge(days, "views")} />
            <Table title="Where they came from" rows={merge(days, "referrers")} />
            <Table title="Papers opened" rows={merge(days, "papers")} />
            <Table title="What they did" rows={merge(days, "events")} />
          </div>

          <section className="mt-14 border-t border-paper-edge pt-9">
            <h2 className="text-[1.35rem] leading-snug">Landing to reading</h2>
            <p className="mt-3 max-w-2xl text-[0.92rem] leading-relaxed text-ink-soft">
              Of the sessions in the last {STREAM_DAYS} days, how many got as far as
              opening a paper, and how far as having one analysed on the spot. A
              session counts at a stage only if it passed every stage before it.
            </p>
            <ul className="mt-6 space-y-2.5">
              {stages.map((stage, i) => (
                <li key={stage} className="flex items-center gap-3">
                  <span className="w-44 shrink-0 text-[0.88rem] text-ink-soft">
                    {["landed", "opened a paper", "had one analysed"][i]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block h-2.5 rounded-[1px] bg-brass/60"
                      style={{
                        width: `${reached[0] ? Math.max(1, (reached[i] / reached[0]) * 100) : 1}%`,
                      }}
                    />
                  </span>
                  <span className="numeral w-24 shrink-0 text-right text-[0.8rem] text-ink-faint">
                    {reached[i]}
                    {i > 0 && reached[0]
                      ? ` · ${Math.round((reached[i] / reached[0]) * 100)}%`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-14 border-t border-paper-edge pt-9">
            <h2 className="text-[1.35rem] leading-snug">How a visit goes</h2>
            <p className="mt-3 max-w-2xl text-[0.92rem] leading-relaxed text-ink-soft">
              The commonest first three things a session does, with repeats collapsed.
            </p>
            {paths.length === 0 ? (
              <p className="mt-5 text-[0.9rem] italic text-ink-faint">
                Not enough sessions yet.
              </p>
            ) : (
              <ul className="mt-5 space-y-1">
                {paths.map((row) => (
                  <li
                    key={row.path}
                    className="flex items-baseline justify-between gap-6 border-b border-paper-edge/60 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-[0.9rem] text-ink">
                      {row.path}
                    </span>
                    <span className="numeral shrink-0 text-[0.8rem] text-ink-faint">
                      {row.n}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="numeral mt-5 text-[0.8rem] text-ink-faint">
              {sessions.length} session{sessions.length === 1 ? "" : "s"} · median{" "}
              {median(sessions.map((s) => s.seconds))}s
            </p>
          </section>
        </>
      )}

      <Footer />
    </main>
  );
}

/* --------------------------------------------------------------------------------- */

function merge(days: DayStats[], part: keyof DayStats): [string, number][] {
  const total = new Map<string, number>();
  for (const day of days) {
    for (const [key, n] of Object.entries(day[part] as Record<string, number>)) {
      total.set(key, (total.get(key) ?? 0) + n);
    }
  }
  return [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function Trend({ days }: { days: DayStats[] }) {
  const ordered = [...days].reverse();
  const peak = Math.max(1, ...ordered.map((d) => d.people));
  return (
    <section className="mt-10 border-t border-paper-edge pt-8">
      <h2 className="text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint">
        People per day
      </h2>
      {/* Capped, so a single recorded day is a bar and not a wall across the page. */}
      <div className="mt-5 flex items-end gap-1" style={{ height: 110 }}>
        {ordered.map((day) => (
          <span
            key={day.day}
            title={`${day.day} — ${day.people} people`}
            className="min-w-0 flex-1 rounded-[1px] bg-brass/55"
            style={{
              height: `${Math.max(2, (day.people / peak) * 100)}%`,
              maxWidth: 46,
            }}
          />
        ))}
      </div>
      <p className="numeral mt-2 flex justify-between text-[0.72rem] text-ink-faint">
        <span>{ordered[0]?.day}</span>
        <span>peak {peak}</span>
        <span>{ordered[ordered.length - 1]?.day}</span>
      </p>
    </section>
  );
}

function Table({ title, rows }: { title: string; rows: [string, number][] }) {
  return (
    <div>
      <h2 className="text-[0.7rem] uppercase tracking-[0.18em] text-ink-faint">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-[0.88rem] italic text-ink-faint">nothing yet</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {rows.map(([key, n]) => (
            <li
              key={key}
              className="flex items-baseline justify-between gap-4 border-b border-paper-edge/60 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-[0.88rem] text-ink-soft">
                {key}
              </span>
              <span className="numeral shrink-0 text-[0.8rem] text-ink-faint">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Locked({
  signedIn,
  configured,
  available,
}: {
  signedIn: boolean;
  configured: boolean;
  available: boolean;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6">
      <h1 className="pressed text-[1.8rem] leading-tight">Traffic</h1>
      <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-soft">
        {!configured ? (
          <>
            Nobody can read this yet, which is the intended default. Set{" "}
            <span className="numeral text-ink">KEYSTONE_OWNER</span> to the email
            address you sign in with &mdash; comma-separated for more than one &mdash;
            and redeploy.
          </>
        ) : !signedIn ? (
          <>
            This page is for whoever runs the site.{" "}
            <a href="/signin" className="text-brass underline decoration-brass/40 underline-offset-2">
              Sign in
            </a>{" "}
            to read it.
          </>
        ) : (
          <>That account is not on the owner list for this site.</>
        )}
      </p>
      {!available ? (
        <p className="mt-4 text-[0.88rem] text-missing">
          No store is configured either, so nothing is being counted.
        </p>
      ) : null}
    </main>
  );
}

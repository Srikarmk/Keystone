import { isArxivId, readArxivId } from "@/lib/arxiv";

/*
 * Keystone as a tool other software can use.
 *
 * A Model Context Protocol server over Streamable HTTP, so an MCP client — Claude
 * among them — can search what this library found, read any paper's citation stances
 * and assumptions, and see where the corpus argues with itself, without a person
 * opening a browser.
 *
 * Written against the protocol rather than an SDK. The whole surface used here is
 * JSON-RPC over one POST: `initialize`, `tools/list`, `tools/call`, `ping`, and a
 * notification to acknowledge. That is a few hundred lines and no dependency to keep
 * current, and it keeps the route a plain Next handler on the same deployment as
 * everything it reads.
 *
 * Stateless: no `Mcp-Session-Id` is issued. Every request carries everything needed to
 * answer it, so there is no session to lose when a serverless instance goes away —
 * which, on this deployment, is after every request.
 *
 * On the spec's DNS-rebinding warning: it exists because a local MCP server can hold
 * privileges a web page must not borrow. Everything here is public, read-only and
 * unauthenticated, so an Origin allowlist would protect nothing and would break
 * browser-based clients. Said out loud rather than silently skipped.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

//: The version this implements. A client asking for a version we know gets it back;
//: anything else gets ours, and the spec leaves it to the client to disconnect if it
//: cannot live with that.
const LATEST = "2025-06-18";
const SUPPORTED = new Set([LATEST, "2025-03-26"]);

const SITE =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://keystone-research.vercel.app";

const STANCE: Record<string, string> = {
  inherits: "adopts",
  extends: "extends",
  contests: "disputes",
  compares: "measures against",
  background: "mentions",
};

interface Row {
  paper: string;
  kind: "edge" | "assumption";
  stance: string;
  text: string;
  cue: string;
  section: string;
  about: string;
  row: string;
}

interface Library {
  titles: Record<string, string>;
  rows: Row[];
}

/**
 * The whole library's readings.
 *
 * Cached by Next's own fetch cache, which has a lifetime. The first version also
 * memoised the promise in a module-level variable, and that was wrong in a way that
 * showed up immediately: a warm instance holds that variable for as long as it lives,
 * so the hour-long revalidation never applied to it. The library grew from 74 papers
 * to 101 and this route went on reporting 40 disputes where there were 52.
 *
 * The fetch cache alone is the same speed and actually expires.
 */
async function library(): Promise<Library> {
  const response = await fetch(`${SITE}/dossiers/search.json`, {
    next: { revalidate: 3600 },
  });
  if (!response.ok) throw new Error("library index unavailable");
  return (await response.json()) as Library;
}

/* --------------------------------------------------------------------------------- *
 * The tools.
 *
 * Three, not eight. Every one of them returns the quoted sentence and a URL that
 * lands on it, because a claim this server makes should be checkable by the person
 * reading the model's answer — which is the same discipline the site is built on.
 * --------------------------------------------------------------------------------- */

const TOOLS = [
  {
    name: "search_library",
    title: "Search what Keystone read",
    description:
      "Search 899 readings taken from 74 arXiv papers' LaTeX source: citation " +
      "stances (adopts, extends, disputes, measures against) and stated assumptions. " +
      "Matches on the quoted sentence, the cue phrase that decided it, and the work " +
      "cited. Returns the sentence verbatim with a link to the exact line.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to look for, e.g. 'layer normalization'" },
        stance: {
          type: "string",
          enum: ["inherits", "extends", "contests", "compares", "background", "bare", "cited", "shown"],
          description:
            "Optional filter. The first five are citation stances; bare/cited/shown " +
            "are what an assumption's own sentence offers for it.",
        },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 15." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "read_paper",
    title: "Read one paper's citations and assumptions",
    description:
      "Everything Keystone reads out of one arXiv paper: what it adopts, extends, " +
      "disputes and measures against, and the assumptions it states with a citation, " +
      "its own evidence, or nothing at all. Works for any paper on arXiv that ships " +
      "LaTeX source — one outside the library is parsed on demand, which takes a few " +
      "seconds. Nothing is summarised or inferred; every line is the paper's own.",
    inputSchema: {
      type: "object",
      properties: {
        arxiv_id: { type: "string", description: "An arXiv id or link, e.g. 1706.03762" },
        include: {
          type: "string",
          enum: ["all", "citations", "assumptions"],
          description: "Default all.",
        },
      },
      required: ["arxiv_id"],
      additionalProperties: false,
    },
  },
  {
    name: "list_disagreements",
    title: "Where the library argues with itself",
    description:
      "Every sentence in the library where a paper says prior work is wrong, or puts " +
      "itself beside it to win. Small on purpose — disagreement is rare and " +
      "concentrated, and the whole set is readable.",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["disputes", "comparisons"],
          description: "Default disputes.",
        },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 40." },
      },
      additionalProperties: false,
    },
  },
] as const;

function urlFor(row: Row): string {
  return `${SITE}/paper/${row.paper}#${row.row}`;
}

function describe(row: Row, titles: Record<string, string>): string {
  const title = titles[row.paper] ?? row.paper;
  if (row.kind === "edge") {
    const verb = STANCE[row.stance] ?? row.stance;
    const target = row.about ? ` ${row.about}` : "";
    return [
      `${title} ${verb}${target}`,
      `  "${row.text}"`,
      `  placed by "${row.cue}" · ${row.section} · ${urlFor(row)}`,
    ].join("\n");
  }
  const offers =
    row.stance === "bare"
      ? "offers nothing for it"
      : row.stance === "cited"
        ? "points at a citation"
        : "points at its own evidence";
  return [
    `${title} assumes something and ${offers}`,
    `  "${row.text}"`,
    `  placed by "${row.cue}" · ${row.section} · ${urlFor(row)}`,
  ].join("\n");
}

async function searchLibrary(args: Record<string, unknown>) {
  const query = String(args.query ?? "").trim().toLowerCase();
  if (query.length < 2) throw new Error("Give me at least two characters to search for.");
  const stance = typeof args.stance === "string" ? args.stance : "";
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 15));

  const { titles, rows } = await library();
  const hits = rows.filter((row) => {
    if (stance && row.stance !== stance) return false;
    return `${row.text} ${row.cue} ${row.about} ${titles[row.paper] ?? ""}`
      .toLowerCase()
      .includes(query);
  });

  const shown = hits.slice(0, limit);
  const text = shown.length
    ? [
        `${hits.length} reading${hits.length === 1 ? "" : "s"} match "${args.query}"` +
          (hits.length > shown.length ? `, showing ${shown.length}` : "") +
          ":",
        "",
        ...shown.map((row) => describe(row, titles)),
      ].join("\n")
    : `Nothing in the library's readings matches "${args.query}". That is a statement ` +
      `about 899 readings from 74 papers, not about the literature.`;

  return {
    text,
    structured: {
      matches: hits.length,
      results: shown.map((row) => ({
        paper: row.paper,
        title: titles[row.paper] ?? row.paper,
        kind: row.kind,
        stance: row.stance,
        sentence: row.text,
        cue: row.cue,
        section: row.section,
        about: row.about || undefined,
        url: urlFor(row),
      })),
    },
  };
}

async function readPaper(args: Record<string, unknown>) {
  const id = readArxivId(String(args.arxiv_id ?? ""));
  if (!id) throw new Error(`"${args.arxiv_id}" is not an arXiv id.`);
  const include = typeof args.include === "string" ? args.include : "all";

  // The library's own file, then the parser. Same order the reader uses, so this
  // answers for any paper on arXiv rather than only the seventy-four here.
  const fromLibrary = await fetch(`${SITE}/dossiers/${id}.json`, {
    next: { revalidate: 3600 },
  });
  const dossier: Record<string, any> = await (async () => {
    if (fromLibrary.ok) return fromLibrary.json();
    const parsed = await fetch(`${SITE}/api/ingest?id=${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(55_000),
    });
    const body = await parsed.json().catch(() => null);
    if (!parsed.ok || !body || body.error) {
      throw new Error(body?.error ?? `Could not read ${id}.`);
    }
    return body;
  })();

  const edges = (dossier.lineage?.edges ?? []) as Record<string, any>[];
  const assumptions = (dossier.assumptions ?? []) as Record<string, any>[];
  const title = dossier.title || id;

  const lines: string[] = [`# ${title}`, `arXiv:${id} · ${SITE}/paper/${id}`];
  if (dossier.onDemand) {
    lines.push(
      "Read on demand, so its citations are not matched against the rest of the " +
        "library and nothing is shown standing on it.",
    );
  }

  if (include !== "assumptions") {
    const spoken = edges.filter((edge) => edge.stance !== "background");
    lines.push("", `## What it says about other work (${spoken.length} readings)`);
    if (spoken.length === 0) {
      lines.push(
        "None. Every citation here is a bare mention with no cue phrase, so nothing " +
          "is claimed about what the paper makes of them.",
      );
    }
    for (const edge of spoken) {
      lines.push(
        `- ${STANCE[edge.stance] ?? edge.stance} ${edge.authors || edge.title || edge.key}`,
        `    "${edge.sentence}"`,
        `    placed by "${edge.cue}" · ${edge.section}`,
      );
    }
  }

  if (include !== "citations") {
    lines.push("", `## What it takes on faith (${assumptions.length})`);
    for (const one of assumptions) {
      const offers =
        one.support === "bare"
          ? "nothing offered"
          : one.support === "cited"
            ? "a citation"
            : "its own evidence";
      lines.push(`- [${offers}] "${one.sentence}"`, `    placed by "${one.cue}" · ${one.section}`);
    }
  }

  return {
    text: lines.join("\n"),
    structured: {
      id,
      title,
      url: `${SITE}/paper/${id}`,
      onDemand: Boolean(dossier.onDemand),
      tally: dossier.lineage?.tally ?? {},
      assumptionTally: dossier.assumptionTally ?? {},
      citations: edges
        .filter((edge) => edge.stance !== "background")
        .map((edge) => ({
          stance: edge.stance,
          about: edge.authors || edge.title || edge.key,
          sentence: edge.sentence,
          cue: edge.cue,
          section: edge.section,
          arxivId: edge.arxivId ?? undefined,
        })),
      assumptions: assumptions.map((one) => ({
        support: one.support,
        kind: one.kind,
        sentence: one.sentence,
        cue: one.cue,
        section: one.section,
      })),
    },
  };
}

async function listDisagreements(args: Record<string, unknown>) {
  const wanted = args.kind === "comparisons" ? "compares" : "contests";
  const limit = Math.min(100, Math.max(1, Number(args.limit) || 40));
  const { titles, rows } = await library();
  const hits = rows.filter((row) => row.kind === "edge" && row.stance === wanted);
  const shown = hits.slice(0, limit);

  return {
    text: [
      wanted === "contests"
        ? `${hits.length} sentences where a paper says prior work is wrong:`
        : `${hits.length} sentences where a paper measures itself against prior work:`,
      "",
      ...shown.map((row) => describe(row, titles)),
    ].join("\n"),
    structured: {
      kind: wanted,
      total: hits.length,
      results: shown.map((row) => ({
        paper: row.paper,
        title: titles[row.paper] ?? row.paper,
        sentence: row.text,
        cue: row.cue,
        about: row.about || undefined,
        section: row.section,
        url: urlFor(row),
      })),
    },
  };
}

/* --------------------------------------------------------------------------------- *
 * JSON-RPC.
 * --------------------------------------------------------------------------------- */

type Id = string | number | null;

function ok(id: Id, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

function err(id: Id, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id, error: { code, message, ...(data ? { data } : {}) } };
}

async function dispatch(message: Record<string, any>): Promise<object | null> {
  const { id = null, method, params = {} } = message;

  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return ok(id, {
        // Echo a version we know; otherwise answer with ours and let the client
        // decide whether it can live with that. Both are what the spec asks for.
        protocolVersion: SUPPORTED.has(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "keystone", title: "Keystone", version: "0.1.0" },
        instructions:
          "Keystone reads arXiv papers' LaTeX source and reports, verbatim, what each " +
          "citation adopts / extends / disputes / measures against and what the paper " +
          "assumes. It is deliberately silent where a sentence carries no cue phrase: " +
          "an empty result means nothing checkable was said, not that nothing matters. " +
          "Every reading comes with the sentence and a URL to the line on the page — " +
          "pass those on, so the person reading your answer can check it.",
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // A notification has no id and takes no response.

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, { tools: TOOLS });

    case "tools/call": {
      const name = params?.name;
      const args = (params?.arguments ?? {}) as Record<string, unknown>;
      const run =
        name === "search_library"
          ? searchLibrary
          : name === "read_paper"
            ? readPaper
            : name === "list_disagreements"
              ? listDisagreements
              : null;
      if (!run) return err(id, -32602, `Unknown tool: ${name}`);

      try {
        const { text, structured } = await run(args);
        // Both shapes: the text is what a model reads, the structured copy is what a
        // program reads. The spec asks for the text block even when structured
        // content is present, and a client that ignores one still gets the answer.
        return ok(id, {
          content: [{ type: "text", text }],
          structuredContent: structured,
          isError: false,
        });
      } catch (cause) {
        // A tool that could not do its job reports that *in the result*, not as a
        // JSON-RPC error: the model should see "arXiv has no paper 9999.99999" and
        // be able to act on it, rather than the client swallowing a protocol fault.
        return ok(id, {
          content: [
            { type: "text", text: cause instanceof Error ? cause.message : "That failed." },
          ],
          isError: true,
        });
      }
    }

    default:
      return err(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(request: Request) {
  const version = request.headers.get("mcp-protocol-version");
  if (version && !SUPPORTED.has(version)) {
    return Response.json(
      err(null, -32600, `Unsupported protocol version: ${version}`, {
        supported: [...SUPPORTED],
      }),
      { status: 400 },
    );
  }

  let message: Record<string, any>;
  try {
    message = await request.json();
  } catch {
    return Response.json(err(null, -32700, "Parse error"), { status: 400 });
  }

  // Batches are permitted by JSON-RPC but not required of a server, and nothing
  // sends them here. Refused explicitly rather than half-handled.
  if (Array.isArray(message)) {
    return Response.json(err(null, -32600, "Batched requests are not supported"), {
      status: 400,
    });
  }

  const answer = await dispatch(message);
  // A notification or response gets 202 with no body, which is what the transport
  // requires — returning a JSON-RPC object with a null id here makes strict clients
  // fail the handshake.
  if (!answer) return new Response(null, { status: 202 });
  return Response.json(answer);
}

/*
 * The transport allows a server to offer no server-initiated stream, and this one has
 * nothing to push: the tools are fixed and every answer belongs to a request. 405 is
 * the documented way to say so.
 */
export async function GET() {
  return new Response("This MCP endpoint does not offer a server-initiated stream.", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

export async function DELETE() {
  // No sessions are issued, so there is nothing to terminate.
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

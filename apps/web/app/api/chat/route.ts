import Anthropic from "@anthropic-ai/sdk";

/*
 * Grounded question answering over one paper.
 *
 * The whole product rests on not paraphrasing confidently. So the model is given the
 * paper's own prose plus the structure already extracted from its LaTeX — the traced
 * numbers, the typed tables, the exact equations — and is told to answer from that or
 * say it cannot. Where a claim has been verified against a table cell, the answer can
 * say so, because the arithmetic has already been done and is in the context.
 */

export const runtime = "nodejs";
export const maxDuration = 60;

interface Body {
  paperId?: string;
  messages?: { role: "user" | "assistant"; content: string }[];
}

const MODEL = "claude-opus-5";

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    // An explicit, readable failure. A chat box that silently does nothing is worse
    // than one that says exactly what is missing.
    return Response.json(
      {
        error: "no_api_key",
        message:
          "Answering questions needs an Anthropic API key. Set ANTHROPIC_API_KEY in the environment (locally in apps/web/.env.local, or as a Vercel project environment variable) and redeploy.",
      },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const paperId = body.paperId;
  const messages = body.messages ?? [];
  if (!paperId || !/^\d{4}\.\d{4,5}$/.test(paperId) || messages.length === 0) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  let context: string;
  try {
    context = await buildContext(origin, paperId);
  } catch {
    return Response.json({ error: "paper_not_found" }, { status: 404 });
  }

  const client = new Anthropic();

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    // The paper is the same on every turn, so it sits in a cached prefix with a long
    // TTL and the question goes after it. A 10k-token paper then costs a tenth of its
    // price to re-read on the second question.
    system: [
      { type: "text", text: INSTRUCTIONS },
      {
        type: "text",
        text: context,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const encoder = new TextEncoder();
  const body_ = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(
            encoder.encode("\n\n_The request was declined._"),
          );
        }
      } catch (cause) {
        const message =
          cause instanceof Anthropic.AuthenticationError
            ? "\n\n_The API key was rejected._"
            : cause instanceof Anthropic.RateLimitError
              ? "\n\n_Rate limited — try again in a moment._"
              : "\n\n_Something went wrong answering that._";
        controller.enqueue(encoder.encode(message));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body_, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

const INSTRUCTIONS = `You answer questions about one research paper, for a reader who has it open in front of them.

Ground every statement in the material you are given. It contains the paper's prose section by section, the numbers already traced to the tables that evidence them, the tables themselves cell by cell, and the equations exactly as the author wrote them.

Rules, in order of importance:

1. If the paper does not answer the question, say so plainly and stop. Do not fill the gap from general knowledge about the field. "The paper does not say" is a useful answer; a confident guess is not.
2. When you state something the paper states, point to where — a section name, a table, or an equation. The reader can then check you.
3. Quote the paper verbatim when the wording matters, in quotation marks.
4. If you are reasoning beyond what the paper states — an implication, a comparison with work not in the paper, an opinion about the method — say that you are doing so in the same sentence.
5. Numbers marked as verified have been checked against the table cell that carries them. Numbers marked as having no evidence were searched for in every table of the paper and not found; say that if it is relevant, since it is a fact about the paper.
6. Be brief. A reader with the paper open wants the answer and the location, not a summary of what they can see.`;

async function buildContext(origin: string, paperId: string): Promise<string> {
  const [dossierResponse, contextResponse] = await Promise.all([
    fetch(`${origin}/dossiers/${paperId}.json`, { cache: "force-cache" }),
    fetch(`${origin}/dossiers/${paperId}.context.json`, { cache: "force-cache" }),
  ]);
  if (!dossierResponse.ok || !contextResponse.ok) throw new Error("not found");

  const dossier = await dossierResponse.json();
  const prose = await contextResponse.json();

  const traced = (dossier.numbers ?? [])
    .map((n: Record<string, unknown>) => {
      const where = n.table ? ` — verified against ${n.table}${n.row ? `, row "${n.row}"` : ""}` : "";
      const unevidenced = n.status === "untraced" ? " — no evidence found in any table" : "";
      return `- ${n.value} (${n.section})${where}${unevidenced}`;
    })
    .join("\n");

  const tables = (dossier.tables ?? [])
    .map((t: Record<string, any>) => {
      const grid = (t.rows ?? [])
        .map((row: { text: string }[]) => row.map((c) => c.text || "·").join(" | "))
        .join("\n");
      return `### ${t.name}${t.caption ? ` — ${t.caption}` : ""}\n${grid}`;
    })
    .join("\n\n");

  const equations = (dossier.equations ?? [])
    .map((e: Record<string, unknown>) => `- ${e.latex}`)
    .join("\n");

  const sections = (prose.sections ?? [])
    .map((s: Record<string, unknown>) => `### ${s.title} (${s.kind})\n${s.text}`)
    .join("\n\n");

  return [
    `# ${prose.title || paperId} (arXiv:${paperId})`,
    dossier.keystone
      ? `\nThe table carrying the most headline numbers is ${dossier.keystone.table} (${dossier.keystone.supported} of ${dossier.coverage.claims}).`
      : "",
    `\n## Numbers stated in the paper, and what evidences them\n${traced || "none found"}`,
    `\n## Tables, as written in the source\n${tables || "none"}`,
    `\n## Equations, exactly as written\n${equations || "none"}`,
    `\n## The paper's text\n${sections}`,
  ].join("\n");
}

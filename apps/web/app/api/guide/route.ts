import Anthropic from "@anthropic-ai/sdk";

import search from "@/public/dossiers/search.json";

/*
 * "What should I read about X?"
 *
 * The obvious way to build this is to hand a model the library and let it write an
 * answer. That would produce the one thing this site does not have anywhere else: a
 * fluent paragraph nobody can check.
 *
 * So the model never writes a quotation. Retrieval picks candidate lines out of the
 * search index by keyword; the model sees them numbered and replies with *numbers*
 * plus a sentence of its own about why each one is relevant; the server resolves
 * those numbers back to the stored rows. A hallucinated index is dropped, and a
 * hallucinated quote is impossible, because the text on screen never passes through
 * the model at all.
 *
 * Imported rather than read from disk: this is a serverless function and `public/`
 * is not on its filesystem.
 */

export const runtime = "nodejs";
export const maxDuration = 45;

interface Row {
  paper: string;
  kind: string;
  stance: string;
  text: string;
  cue: string;
  section: string;
  about: string;
  row: string;
}

const INDEX = search as { titles: Record<string, string>; rows: Row[] };

//: How many candidates the model sees. Enough to choose from, few enough that the
//: whole prompt stays small and the answer comes back while a reader is still
//: looking at the screen.
const CANDIDATES = 45;
const MODEL = "claude-sonnet-5";

const STOP = new Set([
  "the","a","an","of","for","and","on","in","to","with","from","is","are","was",
  "what","which","who","how","why","does","do","did","about","paper","papers",
  "should","i","read","me","tell","find","show","any","anything","that","this",
  "it","its","be","been","can","could","would","there","their","them","they",
]);

function terms(question: string): string[] {
  return [...new Set(
    question.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  )];
}

/** Keyword overlap, favouring lines that match more of the question. */
function retrieve(question: string): Row[] {
  const wanted = terms(question);
  if (wanted.length === 0) return [];
  const scored: { row: Row; score: number }[] = [];
  for (const row of INDEX.rows) {
    const hay = `${row.text} ${row.cue} ${row.about} ${INDEX.titles[row.paper] ?? ""}`.toLowerCase();
    let hit = 0;
    for (const term of wanted) if (hay.includes(term)) hit += 1;
    if (hit === 0) continue;
    // More of the question matched is better; a shorter line carrying the same
    // matches is more likely to be about it rather than to mention it in passing.
    scored.push({ row, score: hit * 1000 - Math.min(row.text.length, 900) / 10 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, CANDIDATES).map((s) => s.row);
}

const SYSTEM = `You help a reader find their way around a small library of machine-learning papers.

You will be given a question and a numbered list of lines taken verbatim from those
papers. Each line is either something a paper said about a work it cites, or an
assumption a paper announced.

Reply with JSON only, in this shape:
{"answer": "<one or two sentences>", "picks": [{"n": <line number>, "why": "<one short sentence>"}]}

Rules, in order of importance:
1. Never write or paraphrase a quotation. You refer to lines by number; the quotation
   is added afterwards from the stored text. If you invent a line number it is dropped.
2. Choose at most 5 lines, fewest first. Two good ones beat five padded ones.
3. If the lines do not answer the question, say so plainly in "answer" and return an
   empty "picks". A confident wrong pointer costs the reader more than an admission.
4. "why" says what that line contributes to the question. Do not restate the line.
5. Plain prose. No markdown, no bullet characters, no hedging preamble.`;

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error: "no_api_key",
        message:
          "Guiding needs an Anthropic API key. Set ANTHROPIC_API_KEY in the " +
          "environment and redeploy. Search still works without it.",
      },
      { status: 503 },
    );
  }

  let question = "";
  try {
    const body = (await request.json()) as { question?: unknown };
    question = typeof body.question === "string" ? body.question.slice(0, 400).trim() : "";
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (question.length < 3) return Response.json({ error: "bad_request" }, { status: 400 });

  const candidates = retrieve(question);
  if (candidates.length === 0) {
    return Response.json({
      answer: "Nothing in the library uses those words.",
      picks: [],
    });
  }

  const listing = candidates
    .map((row, i) => {
      const what =
        row.kind === "edge"
          ? `${INDEX.titles[row.paper] ?? row.paper} ${row.stance} ${row.about || "a cited work"}`
          : `${INDEX.titles[row.paper] ?? row.paper} assumes (${row.stance})`;
      return `${i}. [${what}] ${row.text}`;
    })
    .join("\n");

  let parsed: { answer?: string; picks?: { n?: number; why?: string }[] } = {};
  try {
    const reply = await new Anthropic().messages.create({
      model: MODEL,
      max_tokens: 900,
      system: SYSTEM,
      messages: [{ role: "user", content: `Question: ${question}\n\nLines:\n${listing}` }],
    });
    const text = reply.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    return Response.json(
      { error: "upstream", message: "The guide could not answer. Search still works." },
      { status: 502 },
    );
  }

  // Resolve numbers back to stored rows. Anything out of range is dropped rather
  // than repaired: a pick pointing nowhere is the model having invented one.
  const picks = (parsed.picks ?? [])
    .map((pick) => ({ row: candidates[Number(pick.n)], why: String(pick.why ?? "") }))
    .filter((pick) => pick.row !== undefined)
    .slice(0, 5)
    .map(({ row, why }) => ({
      paper: row.paper,
      title: INDEX.titles[row.paper] ?? row.paper,
      kind: row.kind,
      stance: row.stance,
      section: row.section,
      cue: row.cue,
      about: row.about,
      rowId: row.row,
      text: row.text,
      why,
    }));

  return Response.json({
    answer: String(parsed.answer ?? "").slice(0, 600),
    picks,
    considered: candidates.length,
  });
}

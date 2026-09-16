"use client";

/*
 * Ask the paper a question.
 *
 * Streams from /api/chat, which grounds the answer in the paper's own prose plus the
 * structure already extracted from its LaTeX. When no API key is configured the route
 * says so and this shows that message rather than failing silently — the one thing
 * worse than a missing feature is a box that looks like it works.
 */

import { motion } from "motion/react";
import { useRef, useState } from "react";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "What is the main claim, and what evidences it?",
  "Which numbers here have no evidence in any table?",
  "What does the paper not test?",
];

export function AskTab({ paperId, title }: { paperId: string; title: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function send(question: string) {
    const asked = question.trim();
    if (!asked || busy) return;

    setDraft("");
    setNotice(null);
    const history = [...turns, { role: "user" as const, content: asked }];
    setTurns([...history, { role: "assistant", content: "" }]);
    setBusy(true);

    abort.current?.abort();
    abort.current = new AbortController();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paperId, messages: history }),
        signal: abort.current.signal,
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        setNotice(detail?.message ?? "That request could not be completed.");
        setTurns(history);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("no stream");
      const decoder = new TextDecoder();

      // Append as it arrives, so a long answer reads as it is written rather than
      // appearing all at once after a silent wait.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setTurns((current) => {
          const next = [...current];
          next[next.length - 1] = {
            role: "assistant",
            content: next[next.length - 1].content + chunk,
          };
          return next;
        });
      }
    } catch (cause) {
      if ((cause as Error).name !== "AbortError") {
        setNotice("The connection dropped before the answer finished.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {turns.length === 0 ? (
          <div>
            <p className="text-[0.88rem] leading-relaxed text-ink-soft">
              Ask about <span className="italic">{title}</span>. Answers come from the
              paper&rsquo;s own text and the numbers already traced to their tables —
              and say so when the paper does not answer.
            </p>
            <ul className="mt-3 space-y-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => send(suggestion)}
                    className="text-left text-[0.84rem] italic text-brass transition-colors hover:text-ink"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {turns.map((turn, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {turn.role === "user" ? (
              <p className="border-l-2 border-brass pl-3 text-[0.86rem] text-ink">
                {turn.content}
              </p>
            ) : (
              <p className="whitespace-pre-wrap text-[0.88rem] leading-relaxed text-ink-soft">
                {turn.content}
                {busy && i === turns.length - 1 ? (
                  <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-brass align-middle" />
                ) : null}
              </p>
            )}
          </motion.div>
        ))}

        {notice ? (
          <p className="rounded-[2px] border border-missing/40 bg-paper-deep/40 p-2.5 text-[0.8rem] leading-relaxed text-missing">
            {notice}
          </p>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="mt-3 shrink-0 border-t border-paper-edge pt-3"
      >
        <div className="flex items-end gap-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={2}
            placeholder="Ask about this paper…"
            className="flex-1 resize-none border-b border-ink/20 bg-transparent pb-1 text-[0.86rem] text-ink outline-none transition-colors placeholder:text-ink-faint/70 focus:border-brass"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="shrink-0 border-b border-brass pb-0.5 text-[0.82rem] text-brass transition-colors hover:text-ink disabled:border-paper-edge disabled:text-ink-faint"
          >
            {busy ? "…" : "ask"}
          </button>
        </div>
      </form>
    </div>
  );
}

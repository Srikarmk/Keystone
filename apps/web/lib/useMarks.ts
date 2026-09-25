"use client";

/*
 * The reader's marks on the paper currently open.
 *
 * Optimistic: a highlight appears the instant it is drawn and is reconciled with the
 * server's copy when the write returns. Highlighting is a gesture, and a gesture that
 * waits 200ms for a database feels broken even when it is working. If the write fails
 * the mark is taken back off the page and the reason is said out loud, which is the
 * part optimistic updates usually get wrong.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { track } from "@/components/Track";
import { inOrder, type Mark } from "@/lib/marks";

export interface MarksState {
  marks: Mark[];
  /** Whether anybody is signed in. Marking is offered only when they are. */
  signedIn: boolean;
  /** Signed in, but the deployment has no store. Honest about which is missing. */
  storing: boolean;
  loading: boolean;
  error: string | null;
}

export interface Marks extends MarksState {
  save: (mark: Mark) => Promise<boolean>;
  remove: (id: string) => Promise<void>;
  byId: Map<string, Mark>;
}

/** Short, unguessable enough for a per-reader list, and a legal store key. */
function freshId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("");
}

export function newMarkId(): string {
  return freshId();
}

export function useMarks(paper: string): Marks {
  const [state, setState] = useState<MarksState>({
    marks: [],
    signedIn: false,
    storing: false,
    loading: true,
    error: null,
  });
  // Every paper switch invalidates the requests in flight for the previous one. Left
  // unguarded, a slow GET for the paper you just left overwrites the list for the one
  // you are now reading — with somebody else's page numbers.
  const open = useRef(paper);

  useEffect(() => {
    open.current = paper;
    setState({ marks: [], signedIn: false, storing: false, loading: true, error: null });
    let cancelled = false;
    fetch(`/api/marks?paper=${encodeURIComponent(paper)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((body: { signedIn?: boolean; storing?: boolean; marks?: Mark[] }) => {
        if (cancelled || open.current !== paper) return;
        setState({
          marks: inOrder(Array.isArray(body.marks) ? body.marks : []),
          signedIn: Boolean(body.signedIn),
          storing: Boolean(body.storing),
          loading: false,
          error: null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState((was) => ({ ...was, loading: false, error: "could not load marks" }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [paper]);

  const save = useCallback(
    async (mark: Mark) => {
      const target = paper;
      setState((was) => ({
        ...was,
        error: null,
        marks: inOrder([...was.marks.filter((one) => one.id !== mark.id), mark]),
      }));
      try {
        const response = await fetch(`/api/marks?paper=${encodeURIComponent(target)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mark }),
        });
        const body = (await response.json()) as { marks?: Mark[]; error?: string };
        if (open.current !== target) return response.ok;
        if (!response.ok) {
          setState((was) => ({
            ...was,
            // Taken back off the page. A mark that looks saved and is not is the one
            // outcome worse than refusing to make it in the first place.
            marks: was.marks.filter((one) => one.id !== mark.id),
            error: body.error ?? "could not save that",
          }));
          return false;
        }
        setState((was) => ({
          ...was,
          marks: inOrder(Array.isArray(body.marks) ? body.marks : was.marks),
          error: null,
        }));
        track("mark.create");
        return true;
      } catch {
        if (open.current === target) {
          setState((was) => ({
            ...was,
            marks: was.marks.filter((one) => one.id !== mark.id),
            error: "could not reach the server",
          }));
        }
        return false;
      }
    },
    [paper],
  );

  const remove = useCallback(
    async (id: string) => {
      const target = paper;
      const removed = state.marks.find((one) => one.id === id);
      setState((was) => ({
        ...was,
        marks: was.marks.filter((one) => one.id !== id),
        error: null,
      }));
      try {
        const response = await fetch(
          `/api/marks?paper=${encodeURIComponent(target)}&id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        const body = (await response.json()) as { marks?: Mark[] };
        if (open.current !== target) return;
        if (!response.ok) {
          // Put it back. Believing a deletion that did not happen means the mark
          // returns on the next reload, which reads as the site losing track.
          setState((was) => ({
            ...was,
            marks: removed ? inOrder([...was.marks, removed]) : was.marks,
            error: "could not delete that",
          }));
          return;
        }
        if (Array.isArray(body.marks)) {
          setState((was) => ({ ...was, marks: inOrder(body.marks as Mark[]) }));
        }
      } catch {
        if (open.current === target) {
          setState((was) => ({
            ...was,
            marks: removed ? inOrder([...was.marks, removed]) : was.marks,
            error: "could not reach the server",
          }));
        }
      }
    },
    [paper, state.marks],
  );

  const byId = useMemo(
    () => new Map(state.marks.map((one) => [one.id, one])),
    [state.marks],
  );

  return { ...state, save, remove, byId };
}

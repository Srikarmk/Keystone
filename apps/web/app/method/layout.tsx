import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How it reads, and how often it is wrong",
  description:
    "The cue rules, scored against public benchmarks they were never tuned on — " +
    "what the coverage costs, and what the tool will not tell you.",
  openGraph: {
    title: "How it reads, and how often it is wrong — Keystone",
    description:
      "Scored against public benchmarks the rules were never tuned on.",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

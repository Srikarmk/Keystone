import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "What the field published this week",
  description:
    "New arXiv papers and writing from the labs, taken from the feeds they publish — " +
    "and every paper one click from its citations and assumptions.",
  openGraph: {
    title: "What the field published this week — Keystone",
    description: "New papers and writing, each one click from being read.",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

import type { Metadata } from "next";

/* Metadata for a client page, which cannot export its own (see app/contested). */
export const metadata: Metadata = {
  title: "Two papers, side by side",
  description:
    "What two papers rest on together and where they part — the works both adopt, " +
    "the ones one adopts and the other disputes, each line quoted from its own paper.",
  openGraph: {
    title: "Two papers, side by side — Keystone",
    description: "What two papers rest on together, and where they part, in their own words.",
  },
};

export default function CompareLayout({ children }: { children: React.ReactNode }) {
  return children;
}

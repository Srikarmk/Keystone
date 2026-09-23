import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "What the library takes on faith",
  description:
    "Every assumption the library announces and then gets on with — grouped by the " +
    "phrase that announced it, and filed by what the same sentence offers for it.",
  openGraph: {
    title: "What the library takes on faith — Keystone",
    description:
      "Assumptions quoted as written, grouped by the phrase that announced them.",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

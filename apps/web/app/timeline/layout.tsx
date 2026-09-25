import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "The library, in the order it happened",
  description:
    "Every paper on a time axis, with the works each one adopts drawn across it — " +
    "so the lag between a method appearing and the next paper picking it up is visible.",
  openGraph: {
    title: "The library, in the order it happened — Keystone",
    description: "Every paper on a time axis, with the works each one adopts.",
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}

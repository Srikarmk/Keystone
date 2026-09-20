import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Newsreader } from "next/font/google";
import "./globals.css";

// A transitional serif with real optical warmth for prose, and a mono with genuine
// tabular figures for anything a reader may want to check digit by digit. The
// pairing is the point: argument in one voice, evidence in another.
const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  display: "swap",
  style: ["normal", "italic"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

const SITE = "https://keystone-seven-beta.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Keystone — what is this paper standing on?",
    // Every paper page gets its own title, so a browserful of tabs is readable and
    // a shared link says which paper it is before the page loads.
    template: "%s — Keystone",
  },
  description:
    "What a paper adopts, what it argues with, and what it takes on faith — read " +
    "out of its own LaTeX and pinned to the page that says it.",
  openGraph: {
    type: "website",
    siteName: "Keystone",
    url: SITE,
    title: "Keystone — what is this paper standing on?",
    description:
      "What a paper adopts, what it argues with, and what it takes on faith — read " +
      "out of its own LaTeX and pinned to the page that says it.",
  },
  twitter: { card: "summary_large_image" },
};

// Both themes declared, so the browser chrome matches the page instead of framing a
// dark reader in a white bar.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ea" },
    { media: "(prefers-color-scheme: dark)", color: "#14120f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The pre-paint script below adds `dark` to this element, so the server HTML
    // and the hydrating client necessarily disagree on its class list. That is the
    // intended behaviour, not a mismatch worth warning about.
    <html
      lang="en"
      className={`${newsreader.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Runs before paint. Reading the stored theme in an effect instead means the
          page renders light first and then flips, which is worse on a dark display
          than having no dark mode at all.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('keystone-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body className="grain min-h-screen bg-paper text-ink antialiased">{children}</body>
    </html>
  );
}

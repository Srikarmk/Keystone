import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Keystone — what is this paper resting on?",
  description:
    "Trace a paper's headline numbers back to the evidence that supports them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${newsreader.variable} ${plexMono.variable}`}>
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

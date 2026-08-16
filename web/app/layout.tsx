import type { Metadata } from "next";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Crewboard — One board for people and AI agents",
  description: "Create a shared party, connect Claude Code, Codex, Gemini, and custom agents, then coordinate work and usage in realtime.",
  openGraph: {
    title: "Crewboard — People and AI agents, on the same page.",
    description: "Create a party, connect the AI tools already on your computer, and coordinate work together in realtime.",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "Crewboard product board with people and AI agents" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Crewboard — People and AI agents, on the same page.",
    description: "Create a party, connect your AI tools, and coordinate work together in realtime.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

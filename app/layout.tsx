import type { Metadata, Viewport } from "next";
import { Baloo_2, Noto_Sans_Devanagari, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Baloo 2: rounded, playful, and it has Devanagari, so Hindi headings look just as fun.
const display = Baloo_2({ subsets: ["latin", "devanagari"], variable: "--font-display", weight: ["600", "700", "800"] });
const body = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-body" });
// Hindi text: Plus Jakarta Sans has no Devanagari letters.
const hindi = Noto_Sans_Devanagari({ subsets: ["devanagari"], variable: "--font-hindi", weight: ["400", "600", "700"] });

export const metadata: Metadata = {
  title: "Visa Didi",
  description: "Straight visa and entry answers for Indian passport holders, only from official sources.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff8ef" },
    { media: "(prefers-color-scheme: dark)", color: "#160f2e" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${hindi.variable}`}>
      <body>{children}</body>
    </html>
  );
}

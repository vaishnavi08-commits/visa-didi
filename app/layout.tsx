import type { Metadata, Viewport } from "next";
import { Fraunces, Noto_Sans_Devanagari, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const display = Fraunces({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700"] });
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
    { media: "(prefers-color-scheme: light)", color: "#fbf6ee" },
    { media: "(prefers-color-scheme: dark)", color: "#16130f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${hindi.variable}`}>
      <body>{children}</body>
    </html>
  );
}

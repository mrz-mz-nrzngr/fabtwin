import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = {
  title: "FabTwin: semiconductor fab MES, played as a shift",
  description:
    "A portfolio project. A deterministic discrete-event simulation of a 300 mm fab, a MES-style console, and a 3D floor you run as the shift lead. Every number is simulated.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d1115" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

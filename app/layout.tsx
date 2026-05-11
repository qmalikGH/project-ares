import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TimezoneCookieSetter } from "./TimezoneCookieSetter";

// Sprint v0.11 (Direction C): Geist Sans + Geist Mono — Geist for body/UI text,
// Geist Mono for ALL numeric data (HR, pace, weight, sets×reps, percentages).
// Mono numbers ride a tabular grid so columns of stats line up perfectly.
const geistSans = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// Sprint v0.9 — PWA + Apple Web App metadata.
// Reference: app/manifest.ts is auto-served at /manifest.webmanifest by Next.
export const metadata: Metadata = {
  title: "Project Ares",
  description: "Wissenschaftlich fundierte Hybrid-Training-App",
  applicationName: "Project Ares",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Ares",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport = {
  themeColor: "#0A0A0B",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="de"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <TimezoneCookieSetter />
        {children}
      </body>
    </html>
  );
}

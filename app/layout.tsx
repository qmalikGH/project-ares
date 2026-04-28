import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

// Sprint v0.8: Inter is the new primary face. Stylistic-set ss01 + tabular-nums
// are wired in via globals.css `font-feature-settings` so big numeric displays
// (HR, VDOT, pace) sit on a stable grid.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
    // v0.8: dark mode is the only mode. `dark` class is hard-coded; light-mode
    // re-introduction would happen here in a hypothetical v0.9+.
    <html
      lang="de"
      className={`${inter.variable} ${geistMono.variable} dark h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

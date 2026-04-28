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

export const metadata: Metadata = {
  title: "Project Ares",
  description: "Wissenschaftlich fundierte Hybrid-Training-App",
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

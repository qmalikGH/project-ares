// Web App Manifest (Sprint v0.9) — makes Project Ares installable as a PWA
// on iOS Home Screen + Android. Next App Router auto-serves this at
// /manifest.webmanifest via the file-system route.
//
// Theme/background color match the v0.8 deep-black design so the iOS launch
// surface stays cohesive with the in-app palette.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Project Ares",
    short_name: "Ares",
    description: "Hybrid Training App — Run + Strength + Recovery",
    start_url: "/today",
    display: "standalone",
    background_color: "#0A0A0B",
    theme_color: "#0A0A0B",
    orientation: "portrait",
    categories: ["health", "fitness", "lifestyle"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

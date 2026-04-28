// scripts/generate-icons.ts
//
// One-shot icon-generator for the PWA + Apple touch icons. Reads
// public/icons/icon.svg (and icon-maskable.svg) and writes PNG variants
// at the sizes referenced by app/manifest.ts and app/layout.tsx.
//
// Usage:
//   npx tsx scripts/generate-icons.ts
import sharp from "sharp";
import { readFileSync } from "fs";
import { join } from "path";

const ICONS_DIR = "public/icons";

interface Target {
  source: string;
  out: string;
  size: number;
}

const TARGETS: Target[] = [
  { source: "icon.svg",          out: "icon-192.png",          size: 192 },
  { source: "icon.svg",          out: "icon-512.png",          size: 512 },
  { source: "icon-maskable.svg", out: "icon-maskable-512.png", size: 512 },
  { source: "icon.svg",          out: "apple-touch-icon.png",  size: 180 },
];

async function main() {
  for (const t of TARGETS) {
    const svgBuffer = readFileSync(join(ICONS_DIR, t.source));
    await sharp(svgBuffer)
      .resize(t.size, t.size, { fit: "contain", background: { r: 10, g: 10, b: 11, alpha: 1 } })
      .png({ compressionLevel: 9 })
      .toFile(join(ICONS_DIR, t.out));
    console.log(`✓ ${t.out}  (${t.size}×${t.size})`);
  }
}

main().catch((e) => {
  console.error("Icon generation failed:", e);
  process.exit(1);
});

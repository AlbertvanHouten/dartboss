// Downloads the app's Google Fonts (Latin subsets) into web/fonts so the app works offline and
// makes no third-party requests. Run once, or again after changing the font list:
//   node scripts/fetch-fonts.mjs
import { mkdir, writeFile } from 'node:fs/promises';

const FAMILIES = 'family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=Caveat:wght@500;700';
const KEEP = new Set(['latin', 'latin-ext']);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const OUT = new URL('../web/fonts/', import.meta.url);

const css = await (await fetch(`https://fonts.googleapis.com/css2?${FAMILIES}&display=swap`, { headers: { 'User-Agent': UA } })).text();
await mkdir(OUT, { recursive: true });

// Each block is "/* subset */ @font-face { ... }"
const blocks = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face\s*{[^}]*})/g)];
let out = '/* Barlow, Barlow Condensed and Caveat: SIL Open Font License 1.1 */\n';
for (const [, subset, face] of blocks) {
  if (!KEEP.has(subset)) continue;
  const family = face.match(/font-family:\s*'([^']+)'/)[1];
  const weight = face.match(/font-weight:\s*(\d+)/)[1];
  const url = face.match(/url\(([^)]+)\)/)[1];
  const file = `${family.toLowerCase().replace(/\s+/g, '-')}-${weight}-${subset}.woff2`;
  await writeFile(new URL(file, OUT), Buffer.from(await (await fetch(url)).arrayBuffer()));
  out += `/* ${subset} */\n${face.replace(url, file)}\n`;
}
await writeFile(new URL('fonts.css', OUT), out);
console.log(`Saved ${out.split('@font-face').length - 1} font files to web/fonts`);

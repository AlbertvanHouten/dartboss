// Builds the standalone app into dist/ from src/ (the game's source files) and web/:
//   - assembles the single-file page (dist/oche.html, the version published as a Claude artifact)
//   - wraps the page in a full HTML document with the app manifest, icons and theme colours
//   - swaps Google Fonts for the bundled copies in web/fonts, so nothing loads from third parties
//   - adds native.js (haptics and native storage inside the iOS app; offline cache on the web)
//   - stamps the offline cache with a version so updates reach installed copies, and lists the caller's clips for it
// dist/ is what gets hosted on the web and what Capacitor copies into the iOS app.
//   node scripts/build.mjs
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const part = f => readFile(new URL(`src/${f}`, root), 'utf8');
// Single-file page = head.html, "<style>\n", style.css, "</style>\n", body.html (which owns its leading and
// trailing blank lines), then each script as its tag line + file + "</script>\n", with a blank line between
// scripts: i18n.js, engine.js, games.js, room.js, app.js. The text files hold only what is between the tags.
const src = (await part('head.html')) + '<style>\n' + (await part('style.css')) + '</style>\n' + (await part('body.html'))
  + '<script id="i18n">\n' + (await part('i18n.js')) + '</script>\n\n'
  + '<script id="engine">\n' + (await part('engine.js')) + '</script>\n\n'
  + '<script id="games">\n' + (await part('games.js')) + '</script>\n\n'
  + '<script id="room">\n' + (await part('room.js')) + '</script>\n\n'
  + '<script>\n' + (await part('app.js')) + '</script>\n';

// The source starts with head tags (meta, title, link); everything from <style> on is the page body
const cut = src.indexOf('<style>');
if (cut < 0) throw new Error('src/head.html: expected head tags before the style block');
const headTags = src.slice(0, cut)
  .split('\n')
  .filter(l => l.trim() && !l.includes('fonts.googleapis.com') && !l.includes('fonts.gstatic.com') && !l.includes('claude:'))
  .join('\n');
// The app shows its version in Settings; package.json is the one place it is set
const { version: appVersion } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const body = src.slice(cut).replaceAll('__APP_VERSION__', appVersion);
if (/fonts\.g(oogleapis|static)\.com/.test(body)) throw new Error('oche.html: Google Fonts referenced outside the head');

const html = `<!doctype html>
<html lang="en">
<head>
${headTags}
<meta name="description" content="Darts scorer and trainer: X01, Cricket, Killer, Shanghai, Halve It and practice games, against friends or realistic bots.">
<meta name="theme-color" content="#eceee9" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b100e" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Dartboss">
<meta name="format-detection" content="telephone=no">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="stylesheet" href="fonts/fonts.css">
<style>
/* Base reset (the hosted artifact version gets this from its host page) */
:root { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
html, body { -webkit-text-size-adjust: 100%; }
body { margin: 0; font-size: 14px; font-family: system-ui, sans-serif; overscroll-behavior-y: none; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
<script src="native.js"></script>
</head>
<body>
${body}
</body>
</html>
`;

// The version covers every file that ships, so a change to any of them refreshes installed copies
const hash = createHash('sha256').update(html);
for (const f of (await readdir(new URL('web/', root), { recursive: true })).sort()) {
  const file = new URL(`web/${f}`, root);
  if ((await stat(file)).isFile()) hash.update(f).update(await readFile(file));
}
const version = hash.digest('hex').slice(0, 10);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(new URL('web/', root), dist, { recursive: true });
await writeFile(new URL('index.html', dist), html);
await writeFile(new URL('oche.html', dist), src);
const caller = (await readdir(new URL('web/caller/', root))).sort().map(f => `caller/${f}`);
const sw = (await readFile(new URL('web/sw.js', root), 'utf8')).replace('__VERSION__', version)
  .replace('/*__CALLER__*/[]', JSON.stringify(caller));
await writeFile(new URL('sw.js', dist), sw);
console.log(`Built dist/ (version ${version})`);

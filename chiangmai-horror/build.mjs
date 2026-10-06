// Bundles src/ into single-file builds:
//   dist/index.html     standalone page, opens straight from disk
//   dist/artifact.html  the same page as a body fragment for hosts that add their own <html> shell
// Usage: node build.mjs   (needs esbuild; set ESBUILD to its binary if it is not on PATH)

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const esbuild = process.env.ESBUILD || 'esbuild';
const js = execFileSync(esbuild, ['src/main.js', '--bundle', '--format=iife', '--minify', '--target=es2020', '--legal-comments=none'], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
const html = readFileSync('index.html', 'utf8');
const cut = (a, b) => html.slice(html.indexOf(a) + a.length, html.indexOf(b));
const head = cut('<!--HEAD-START-->', '<!--HEAD-END-->').trim();
const body = cut('<!--BODY-START-->', '<!--BODY-END-->').trim();
const script = `<script>\n${js.replace(/<\/script/gi, '<\\/script')}</script>`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
${body}
${script}
</body>
</html>
`);
writeFileSync('dist/artifact.html', `${head}\n${body}\n${script}\n`);
console.log(`dist/index.html  ${(readFileSync('dist/index.html').length / 1024).toFixed(0)} KB`);

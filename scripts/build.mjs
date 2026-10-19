// Builds the game into self-contained HTML:
//   dist/index.html    — a standalone page (open it directly in a browser)
//   dist/artifact.html — the same page as a fragment (no html/head/body), for publishing
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const minify = !process.argv.includes('--dev');

async function once() {
  const res = await build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify,
    sourcemap: false,
    write: false,
    legalComments: 'none',
  });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const page = readFileSync('src/ui/page.html', 'utf8').replace('<script>/*GAME_SCRIPT*/</script>', () => `<script>${js}</script>`);
  const [head, body] = page.split('<!--BODY-->');
  const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="UNDERTOW — a tide-driven traditional roguelike. Climb ten floors before the sea takes you.">
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`;
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/index.html', standalone);
  writeFileSync('dist/artifact.html', `${head.trim()}\n${body.trim()}\n`);
  console.log(`dist/index.html ${(standalone.length / 1024).toFixed(1)} KB (+ dist/artifact.html)`);
}

await once();
if (watch) {
  const { watch: fsWatch } = await import('node:fs');
  let timer;
  fsWatch('src', { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => once().catch((e) => console.error(e.message)), 80);
  });
  console.log('watching src/ …');
}

// Bundles the main process, preload (Node) and the renderer script and stylesheet (browser) into dist/.
// Usage: node scripts/build.mjs [--watch] [--production]
import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');
const common = { bundle: true, sourcemap: !production, minify: production, logLevel: 'info' };
// src/core lives in ../vscode-extension; its `yaml` import resolves from this package's node_modules.
const nodePaths = [path.join(root, 'node_modules')];

const builds = [
  {
    ...common,
    entryPoints: { main: 'src/main/main.ts', preload: 'src/preload/preload.ts' },
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
    nodePaths,
    outdir: 'dist/main',
  },
  {
    ...common,
    // styles.css pulls in design/tokens.css and the fonts, so dist/renderer is self-contained.
    entryPoints: { app: 'src/renderer/app.ts', styles: 'src/renderer/styles.css' },
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    loader: { '.woff2': 'file', '.woff': 'file' },
    nodePaths,
    outdir: 'dist/renderer',
  },
];

await mkdir('dist/renderer', { recursive: true });
await copyFile('src/renderer/index.html', 'dist/renderer/index.html');
// Window icon; build/icon.png is also what electron-builder turns into the installer icons.
await copyFile('build/icon.png', 'dist/icon.png');

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}

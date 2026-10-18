// Bundles the extension (Node) and the webview scripts and stylesheet (browser) into dist/.
// Usage: node scripts/build.mjs [--watch] [--production]
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');
const common = { bundle: true, sourcemap: !production, minify: production, logLevel: 'info' };

const builds = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    external: ['vscode'],
    outfile: 'dist/extension.js',
  },
  {
    ...common,
    // webview.css pulls in design/tokens.css and the codicon font, so dist/webview is self-contained.
    entryPoints: {
      sidebar: 'src/webview/sidebar.ts',
      detail: 'src/webview/detail.ts',
      add: 'src/webview/add.ts',
      webview: 'src/webview/webview.css',
    },
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    loader: { '.ttf': 'file' },
    outdir: 'dist/webview',
  },
];

if (watch) {
  for (const options of builds) await (await esbuild.context(options)).watch();
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}

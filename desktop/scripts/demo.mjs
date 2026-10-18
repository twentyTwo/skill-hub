// Launches the app against a throwaway hub and projects (see test/fixture.ts), leaving your real settings and hub alone.
// Usage: npm run demo [-- --keep]   (--keep reuses the sandbox from the last run)
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { createRequire } from 'module';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const sandbox = path.join(os.tmpdir(), 'skill-hub-demo');
const userData = path.join(sandbox, 'user-data');

if (!process.argv.includes('--keep') || !existsSync(userData)) {
  await rm(sandbox, { recursive: true, force: true, maxRetries: 3 });
  await mkdir(userData, { recursive: true });
  const { createFixture } = require(path.join(root, 'out', 'desktop', 'test', 'fixture.js'));
  const fixture = await createFixture(sandbox);
  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ libraryPath: fixture.hub, projects: fixture.projects }, null, 2));
  console.log(`Demo sandbox: ${sandbox}`);
}

const electron = require('electron');
const env = { ...process.env, SKILL_HUB_USER_DATA: userData };
// Inherited from VS Code terminals; it would make Electron run as plain Node.
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { cwd: root, stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));

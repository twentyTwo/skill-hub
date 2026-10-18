import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

/** Launches VS Code with the extension and a scratch workspace, profile and hub. Set VSCODE_PATH to use an installed VS Code. */
async function main(): Promise<void> {
  // Inherited when started from inside VS Code; it would make the launched Code.exe behave as plain Node.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-hub-it-'));
  const workspace = path.join(tmp, 'workspace');
  await fs.mkdir(workspace);
  try {
    await runTests({
      vscodeExecutablePath: process.env.VSCODE_PATH || undefined,
      extensionDevelopmentPath: path.resolve(__dirname, '../..'),
      extensionTestsPath: path.join(__dirname, 'suite'),
      extensionTestsEnv: { SKILL_HUB_TEST_TMP: tmp },
      launchArgs: [workspace, '--disable-extensions', '--skip-welcome', `--user-data-dir=${path.join(tmp, 'user')}`, `--extensions-dir=${path.join(tmp, 'extensions')}`],
    });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

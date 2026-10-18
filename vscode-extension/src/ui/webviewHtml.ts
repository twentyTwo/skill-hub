import { randomBytes } from 'crypto';
import * as vscode from 'vscode';

/** Where the build puts the webview scripts and webview.css, which bundles tokens.css and codicons (scripts/build.mjs). */
export function webviewRoot(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
}

export function webviewOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
  return { enableScripts: true, localResourceRoots: [webviewRoot(extensionUri)] };
}

/**
 * The page shell shared by every Skill Hub webview: design tokens, codicons, a strict CSP, and one bundled script.
 * `bodyClass` picks the surface (`sh-sidebar` or `sh-editor`).
 */
export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, script: string, title: string, bodyClass: string): string {
  const root = webviewRoot(extensionUri);
  const uri = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(root, file)).toString();
  const nonce = randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `img-src ${webview.cspSource} https: data:`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('webview.css')}">
<title>${title}</title>
</head>
<body class="sh-vscode ${bodyClass}">
<div id="app"></div>
<script nonce="${nonce}" src="${uri(script)}"></script>
</body>
</html>`;
}

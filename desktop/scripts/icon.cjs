// Renders the app icon (the hexagon logo from design/mockups on a dark tile) to build/icon.png.
// electron-builder makes the .ico/.icns from it. Usage: npm run icon (only needed when the logo changes).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 64 64">
  <rect x="2" y="2" width="60" height="60" rx="14" fill="#16191E"/>
  <rect x="2.5" y="2.5" width="59" height="59" rx="13.5" fill="none" stroke="#333944"/>
  <g transform="translate(12 12) scale(1.6667)" fill="none" stroke="#FF9A4D" stroke-width="1.6" stroke-linejoin="round">
    <path d="M12 2.5l8.25 4.75v9.5L12 21.5l-8.25-4.75v-9.5z"/>
    <path d="M12 8l1.2 2.8L16 12l-2.8 1.2L12 16l-1.2-2.8L8 12l2.8-1.2z" fill="#FF9A4D"/>
  </g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0;background:transparent">${svg}</body>`)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = (await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })).resize({ width: 512, height: 512, quality: 'best' });
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, image.toPNG());
  console.log(`Wrote ${out}`);
  app.exit(0);
});

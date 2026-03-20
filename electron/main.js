const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let win;
let server;

function startServer() {
  server = spawn('node', ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: '3847' },
    stdio: 'inherit',
  });
  server.on('error', err => console.error('Server error:', err));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 820,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f8f7f4',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const tryLoad = (attempts = 0) => {
    win.loadURL('http://localhost:3847').catch(() => {
      if (attempts < 10) setTimeout(() => tryLoad(attempts + 1), 500);
    });
  };

  setTimeout(() => tryLoad(), 1000);

  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  startServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!win) createWindow();
});

app.on('before-quit', () => {
  if (server) server.kill();
});

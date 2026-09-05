const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

let mainWindow = null;
let isQuitting = false;

function startBackendServer() {
  return new Promise((resolve) => {
    process.env.PORT = process.env.PORT || '48899';
    try {
      require('./server/index.js');
    } catch (e) {
      console.log('Server already running or loaded:', e.message);
    }
    setTimeout(resolve, 600);
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{
      label: app.name || 'Service Monitor',
      submenu: [
        { role: 'about', label: 'Về Service Monitor' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Ẩn Service Monitor' },
        { role: 'hideOthers', label: 'Ẩn các ứng dụng khác' },
        { role: 'unhide', label: 'Hiện tất cả' },
        { type: 'separator' },
        { role: 'quit', label: 'Thoát Service Monitor' }
      ]
    }] : []),
    {
      label: 'Chỉnh sửa',
      submenu: [
        { role: 'undo', label: 'Hoàn tác' },
        { role: 'redo', label: 'Làm lại' },
        { type: 'separator' },
        { role: 'cut', label: 'Cắt' },
        { role: 'copy', label: 'Sao chép' },
        { role: 'paste', label: 'Dán' },
        { role: 'selectAll', label: 'Chọn tất cả' }
      ]
    },
    {
      label: 'Giao diện',
      submenu: [
        { role: 'reload', label: 'Tải lại' },
        { role: 'forceReload', label: 'Tải lại toàn bộ' },
        { role: 'toggleDevTools', label: 'Mở Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Kích thước mặc định' },
        { role: 'zoomIn', label: 'Phóng to' },
        { role: 'zoomOut', label: 'Thu nhỏ' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toàn màn hình' }
      ]
    },
    {
      label: 'Cửa sổ',
      submenu: [
        { role: 'minimize', label: 'Thu nhỏ' },
        { role: 'zoom', label: 'Phóng lớn' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front', label: 'Đưa lên đầu' }
        ] : [
          { role: 'close', label: 'Đóng' }
        ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

async function cleanupAndExit() {
  if (isQuitting) return;
  isQuitting = true;
  try {
    const processManager = require('./server/services/process-manager');
    await processManager.stopAll();
    const tunnelManager = require('./server/services/tunnel-manager');
    tunnelManager.stopAll();
  } catch (e) {
    console.error('Error during cleanup:', e);
  }
}

async function createWindow() {
  await startBackendServer();
  buildMenu();

  const port = process.env.PORT || '48899';

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    title: 'Service Monitor & Env Manager',
    backgroundColor: '#070a12',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 14 },
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', async () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', async (event) => {
  if (!isQuitting) {
    event.preventDefault();
    await cleanupAndExit();
    app.exit(0);
  }
});

app.on('window-all-closed', async () => {
  await cleanupAndExit();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

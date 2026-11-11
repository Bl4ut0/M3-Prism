const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');

let mainWindow;
let windowUserAgentHookRegistered = false;

function configureRuntimeEnvironment() {
  const userDataPath = app.getPath('userData');

  process.env.DB_PATH = path.join(userDataPath, 'user_data.db');
  process.env.CACHE_DIR = path.join(userDataPath, 'cache', 'assets');
  process.env.EXE_DIR = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  process.env.USER_DATA_DIR = userDataPath;
  process.env.M3PRISM_DESKTOP = 'true';
}

function getConfiguredUserAgent() {
  const { DEFAULT_RUNTIME_CONFIG, getRuntimeConfig } = require('./server/runtimeConfig');
  return getRuntimeConfig().config.userAgent || DEFAULT_RUNTIME_CONFIG.userAgent;
}

function registerWindowUserAgentHook(targetWindow) {
  if (windowUserAgentHookRegistered) {
    return;
  }

  targetWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = {
      ...details.requestHeaders,
      'User-Agent': getConfiguredUserAgent(),
    };

    callback({ requestHeaders });
  });

  windowUserAgentHookRegistered = true;
}

function checkServerAndLoad(serverUrl, uiUrl) {
  const targetServerUrl = serverUrl.replace('localhost', '127.0.0.1');
  const targetUiUrl = uiUrl.replace('localhost', '127.0.0.1');

  http.get(targetServerUrl + '/api/status', (res) => {
    if (res.statusCode === 200) {
      http.get(targetUiUrl, (uiResponse) => {
        uiResponse.resume();
        if (uiResponse.statusCode >= 200 && uiResponse.statusCode < 500) {
          console.log(`Server found at ${targetServerUrl}. Loading UI from ${targetUiUrl}...`);
          mainWindow.loadURL(targetUiUrl);
        } else {
          setTimeout(() => checkServerAndLoad(serverUrl, uiUrl), 500);
        }
      }).on('error', () => setTimeout(() => checkServerAndLoad(serverUrl, uiUrl), 500));
    } else {
      setTimeout(() => checkServerAndLoad(serverUrl, uiUrl), 500);
    }
  }).on('error', () => {
    setTimeout(() => checkServerAndLoad(serverUrl, uiUrl), 500);
  });
}

function createWindow() {
  const configuredUserAgent = getConfiguredUserAgent();
  app.userAgentFallback = configuredUserAgent;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    title: "M3 Prism",
    backgroundColor: '#05080f',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.webContents.setUserAgent(configuredUserAgent);
  registerWindowUserAgentHook(mainWindow);
  
  // Start checking for server
  const uiUrl = app.isPackaged ? 'http://127.0.0.1:3001' : 'http://127.0.0.1:3000';
  checkServerAndLoad('http://127.0.0.1:3001', uiUrl);
}

let backendProcess;

const startBackend = () => {
  const { fork } = require('child_process');
  const serverPath = path.join(__dirname, 'server', 'index.js');
  
  const env = { ...process.env };
  if (!app.isPackaged) {
    env.DB_PATH = path.join(__dirname, 'server', 'user_data.db');
  }

  backendProcess = fork(serverPath, [], {
    env,
    stdio: 'inherit'
  });

  backendProcess.on('exit', (code) => {
    console.log(`Backend process exited with code ${code}`);
  });
};

app.whenReady().then(() => {
  configureRuntimeEnvironment();
  startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (backendProcess) backendProcess.kill();
  if (process.platform !== 'darwin') {    
    app.quit();
  } else {
    process.exit(0);
  }
});

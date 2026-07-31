import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import * as os from 'os';

// Task 35: Nama proses
process.title = 'dardcor-code';

// Task 30: app.setAppUserModelId
app.setAppUserModelId('Dardcor.DardcorCode');

// Task 31: User data folder default
const home = os.homedir();
let userDataPath = path.join(home, '.config', 'dardcor-code');
if (process.platform === 'win32') {
  userDataPath = path.join(app.getPath('appData'), 'Dardcor Code');
} else if (process.platform === 'darwin') {
  userDataPath = path.join(home, 'Library', 'Application Support', 'Dardcor Code');
}
app.setPath('userData', userDataPath);

// Task 32: Extension folder
const extPath = path.join(home, '.dardcor-code', 'extensions');
process.env['VSCODE_EXTENSIONS'] = extPath;

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    title: 'Dardcor Code', // Task 29: name package
    icon: path.join(__dirname, '..', '..', 'public', 'dardcor-code.png'), // Task 34: Ikon aplikasi
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile(path.join(__dirname, '..', '..', 'index.html'));
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      // Re-create window
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

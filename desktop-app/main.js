const { app, BrowserWindow, Menu, globalShortcut } = require('electron');
const path = require('path');

const URL_SITE = 'https://verificar-chassi.netlify.app';

let janelaPrincipal = null;
let sempreVisivel = false;

function criarJanela() {
  janelaPrincipal = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 480,
    minHeight: 400,
    title: 'Verificador de Chassi',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  janelaPrincipal.loadURL(URL_SITE);

  montarMenu();
}

function alternarSempreVisivel() {
  sempreVisivel = !sempreVisivel;
  if (janelaPrincipal) {
    janelaPrincipal.setAlwaysOnTop(sempreVisivel, 'floating');
  }
  montarMenu();
  return sempreVisivel;
}

function montarMenu() {
  const template = [
    {
      label: 'Janela',
      submenu: [
        {
          label: 'Sempre visível (por cima de tudo)',
          type: 'checkbox',
          checked: sempreVisivel,
          accelerator: 'Ctrl+Shift+T',
          click: () => alternarSempreVisivel(),
        },
        { type: 'separator' },
        {
          label: 'Recarregar',
          accelerator: 'Ctrl+R',
          click: () => janelaPrincipal && janelaPrincipal.reload(),
        },
        { role: 'quit', label: 'Sair' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  criarJanela();

  globalShortcut.register('Control+Shift+T', () => alternarSempreVisivel());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

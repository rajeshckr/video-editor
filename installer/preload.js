const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings:   ()  => ipcRenderer.invoke('get-settings'),
  saveSettings:  (s) => ipcRenderer.invoke('save-settings', s),
  pickFolder:    ()  => ipcRenderer.invoke('pick-folder'),
  serverStatus:  ()  => ipcRenderer.invoke('server-status'),
  startServer:   ()  => ipcRenderer.invoke('start-server'),
  stopServer:    ()  => ipcRenderer.invoke('stop-server'),
});

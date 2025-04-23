// c:\thorgrid-electron\preload.js
const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script executing.'); // Debug log

// Expose a safe way for the renderer (multitg.html) to request the server address
contextBridge.exposeInMainWorld('electronAPI', {
  getServerAddress: () => ipcRenderer.invoke('get-server-address'),
  // Add any other main-process functions you might need here
  // For example, if you wanted client-side file dialogs:
  // openFileDialog: () => ipcRenderer.invoke('dialog:openFile')
});

console.log('electronAPI exposed:', typeof window.electronAPI); // Debug log
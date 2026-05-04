const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    saveVideo: (orderCode, arrayBuffer) => ipcRenderer.invoke('save-video', orderCode, arrayBuffer),
    getSyncStatus: () => ipcRenderer.invoke('get-sync-status')
});

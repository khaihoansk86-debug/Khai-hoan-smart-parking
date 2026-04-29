const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Hàm này giúp gửi video và mã đơn hàng sang main.js
    uploadVideo: (orderCode, arrayBuffer) => ipcRenderer.invoke('upload-video', orderCode, arrayBuffer)
});
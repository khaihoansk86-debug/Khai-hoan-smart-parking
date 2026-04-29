const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// ==========================================
// CẤU HÌNH WEBHOOK N8N (ĐIỀN LINK CỦA BẠN VÀO ĐÂY)
// ==========================================
const N8N_WEBHOOK_URL = 'https://cougar-bold-arachnid.ngrok-free.app/webhook/d3938520-9677-4452-acd8-1d1f796011e7';

// ==========================================
// TẠO CỬA SỔ APP
// ==========================================
function createWindow() {
    const win = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    win.loadFile('index.html');
}

app.whenReady().then(createWindow);

// ==========================================
// LẮNG NGHE LỆNH TỪ GIAO DIỆN VÀ BẮN SANG N8N
// ==========================================
ipcMain.handle('upload-video', async (event, scannedCode, arrayBuffer) => {
    try {
        console.log(`Đang gửi video mã vận đơn ${scannedCode} sang n8n...`);

        // 1. Gói video lại thành định dạng File (Blob)
        const blob = new Blob([arrayBuffer], { type: 'video/webm' });
        const formData = new FormData();
        
        // 2. Gắn Mã vận đơn và File Video vào Gói hàng để gửi đi
        // Lưu ý: Tên biến 'orderCode' và 'videoFile' sẽ được n8n nhận diện
        formData.append('orderCode', scannedCode);
        formData.append('videoFile', blob, `${scannedCode}.webm`);

        // 3. Bắn gói hàng qua cửa khẩu Webhook của n8n
        const response = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            body: formData
        });

        // Kiểm tra xem n8n có nhận thành công không
        if (response.ok) {
            console.log(`✅ Đã gửi thành công mã ${scannedCode} sang n8n!`);
            return { success: true };
        } else {
            throw new Error(`n8n từ chối nhận file (Status: ${response.status})`);
        }

    } catch (error) {
        console.error("❌ Lỗi khi gửi sang n8n:", error);
        return { success: false, error: error.message };
    }
});
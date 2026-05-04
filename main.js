const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const N8N_WEBHOOK_URL = 'https://cougar-bold-arachnid.ngrok-free.app/webhook/d3938520-9677-4452-acd8-1d1f796011e7';

// Doi duong dan nay thanh thu muc Google Drive for desktop tren may cua ban.
// Co the dung bien moi truong LOCAL_DRIVE_VIDEO_DIR de doi ma khong can sua code.
const LOCAL_DRIVE_VIDEO_DIR = process.env.LOCAL_DRIVE_VIDEO_DIR || 'G:\\My Drive\\KhaiHoan-SmartPacking\\Video đóng gói Shopee';
const PENDING_QUEUE_FILE = path.join(app.getPath('userData'), 'pending-webhook-queue.json');
const WEBHOOK_RETRY_INTERVAL_MS = 30000;

let isProcessingQueue = false;

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

app.whenReady().then(() => {
    createWindow();
    startQueueWorker();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function sanitizeOrderCode(orderCode) {
    return String(orderCode || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/[^A-Z0-9_-]/g, '');
}

async function ensureVideoDirectory() {
    await fs.mkdir(LOCAL_DRIVE_VIDEO_DIR, { recursive: true });
}

async function readQueue() {
    try {
        const raw = await fs.readFile(PENDING_QUEUE_FILE, 'utf8');
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        console.error('Khong doc duoc hang doi webhook:', error);
        return [];
    }
}

async function writeQueue(queue) {
    await fs.mkdir(path.dirname(PENDING_QUEUE_FILE), { recursive: true });
    await fs.writeFile(PENDING_QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8');
}

async function enqueueWebhookJob(job) {
    const queue = await readQueue();
    const exists = queue.some(item => item.orderCode === job.orderCode && item.fileName === job.fileName);
    if (!exists) {
        queue.push({ ...job, createdAt: new Date().toISOString(), attempts: 0 });
        await writeQueue(queue);
    }
}

async function notifyN8n(job) {
    const response = await fetch(N8N_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            orderCode: job.orderCode,
            fileName: job.fileName,
            localPath: job.localPath
        })
    });

    if (!response.ok) throw new Error(`n8n tra ve HTTP ${response.status}`);
}

async function processWebhookQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    try {
        const queue = await readQueue();
        if (queue.length === 0) return;

        const remaining = [];
        for (const job of queue) {
            try {
                await notifyN8n(job);
                console.log(`Da bao n8n xu ly video ${job.fileName}`);
            } catch (error) {
                remaining.push({
                    ...job,
                    attempts: (job.attempts || 0) + 1,
                    lastError: error.message,
                    lastAttemptAt: new Date().toISOString()
                });
                console.error(`Chua gui duoc webhook ${job.fileName}:`, error.message);
            }
        }

        await writeQueue(remaining);
    } finally {
        isProcessingQueue = false;
    }
}

function startQueueWorker() {
    processWebhookQueue();
    const timer = setInterval(processWebhookQueue, WEBHOOK_RETRY_INTERVAL_MS);
    timer.unref?.();
}

ipcMain.handle('save-video', async (event, scannedCode, arrayBuffer) => {
    const orderCode = sanitizeOrderCode(scannedCode);
    if (!orderCode) return { success: false, error: 'Ma van don khong hop le.' };

    try {
        await ensureVideoDirectory();

        const fileName = `${orderCode}.webm`;
        const localPath = path.join(LOCAL_DRIVE_VIDEO_DIR, fileName);
        await fs.writeFile(localPath, Buffer.from(arrayBuffer));

        const job = { orderCode, fileName, localPath };
        await enqueueWebhookJob(job);
        processWebhookQueue();

        return {
            success: true,
            savedLocal: true,
            fileName,
            localPath,
            message: 'Da luu video vao thu muc Drive local. Neu mat mang, webhook se tu gui lai.'
        };
    } catch (error) {
        console.error('Loi khi luu video local:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('get-sync-status', async () => {
    const queue = await readQueue();
    return { videoDir: LOCAL_DRIVE_VIDEO_DIR, pendingCount: queue.length };
});


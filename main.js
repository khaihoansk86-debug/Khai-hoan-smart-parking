const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');

const N8N_WEBHOOK_URL = 'https://cougar-bold-arachnid.ngrok-free.app/webhook/d3938520-9677-4452-acd8-1d1f796011e7';

// Doi duong dan nay thanh thu muc Google Drive for desktop tren may cua ban.
// Co the dung bien moi truong LOCAL_DRIVE_VIDEO_DIR de doi ma khong can sua code.
const LOCAL_DRIVE_VIDEO_DIR = process.env.LOCAL_DRIVE_VIDEO_DIR || 'G:\\My Drive\\KhaiHoan-SmartPacking\\Video đóng gói Shopee';
const PENDING_QUEUE_FILE = path.join(app.getPath('userData'), 'pending-webhook-queue.json');
const WEBHOOK_RETRY_INTERVAL_MS = 30000;
const WEBHOOK_DELIVERY_DELAYS_MS = [0, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];
const WEBHOOK_MAX_ERROR_ATTEMPTS = 20;

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
    const now = new Date().toISOString();
    const existingIndex = queue.findIndex(item => item.orderCode === job.orderCode && item.fileName === job.fileName);

    const queuedJob = {
        ...job,
        createdAt: now,
        updatedAt: now,
        errorAttempts: 0,
        successfulDeliveries: 0,
        nextAttemptAt: now
    };

    if (existingIndex >= 0) {
        queue[existingIndex] = {
            ...queue[existingIndex],
            ...queuedJob
        };
    } else {
        queue.push(queuedJob);
    }

    await writeQueue(queue);
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

        const nowMs = Date.now();
        const remaining = [];
        for (const job of queue) {
            const nextAttemptMs = job.nextAttemptAt ? new Date(job.nextAttemptAt).getTime() : 0;
            if (nextAttemptMs > nowMs) {
                remaining.push(job);
                continue;
            }

            try {
                await notifyN8n(job);
                const successfulDeliveries = (job.successfulDeliveries || 0) + 1;
                const nextDelay = WEBHOOK_DELIVERY_DELAYS_MS[successfulDeliveries];

                console.log(`Da bao n8n xu ly video ${job.fileName} lan ${successfulDeliveries}/${WEBHOOK_DELIVERY_DELAYS_MS.length}`);

                if (nextDelay !== undefined) {
                    remaining.push({
                        ...job,
                        successfulDeliveries,
                        errorAttempts: 0,
                        lastSuccessAt: new Date().toISOString(),
                        nextAttemptAt: new Date(Date.now() + nextDelay).toISOString()
                    });
                }
            } catch (error) {
                const errorAttempts = (job.errorAttempts || job.attempts || 0) + 1;
                console.error(`Chua gui duoc webhook ${job.fileName}:`, error.message);

                if (errorAttempts < WEBHOOK_MAX_ERROR_ATTEMPTS) {
                    remaining.push({
                        ...job,
                        errorAttempts,
                        lastError: error.message,
                        lastAttemptAt: new Date().toISOString(),
                        nextAttemptAt: new Date(Date.now() + WEBHOOK_RETRY_INTERVAL_MS).toISOString()
                    });
                } else {
                    console.error(`Bo qua webhook ${job.fileName} sau ${errorAttempts} lan loi.`);
                }
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


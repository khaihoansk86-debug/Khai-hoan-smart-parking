const { app, BrowserWindow } = require('electron')

function createWindow () {
  const win = new BrowserWindow({
    width: 1000, // Cửa sổ rộng 1000px
    height: 700  // Cao 700px
  })

  // Yêu cầu Electron tải cái mặt tiền HTML lên
  win.loadFile('index.html') 
}

// Lệnh quan trọng: Khi Electron khởi động xong, hãy gọi hàm mở cửa sổ
app.whenReady().then(() => {
  createWindow()
})
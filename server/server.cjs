console.log("--- STARTING SERVER SCRIPT ---"); // 1. Перевірка запуску

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');

console.log("--- MODULES LOADED ---"); // 2. Перевірка бібліотек

const app = express();
app.use(cors());

// Перевірка шляху до папки client
const distPath = path.join(__dirname, '../client/dist');
console.log(`Serving static files from: ${distPath}`);
app.use(express.static(distPath));

const server = http.createServer(app);
const io = new Server(server, {
   cors: { origin: "*", methods: ["GET", "POST"] }
});

console.log("--- SOCKET.IO SETUP DONE ---"); // 3. Сокети готові

// ... (ТВІЙ КОД ГРИ ТУТ: checkShipStatus, isLoser, io.on connection) ...
// (Обов'язково залиш тут свою логіку гри, я її скоротив для зручності)
// ...

app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// Запуск сервера
const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => { // Додав '0.0.0.0' для надійності
   console.log(`SERVER RUNNING ON PORT ${PORT}`);
   console.log("--- READY FOR CONNECTION ---");
});

// Ловимо помилки, щоб сервер не падав мовчки
process.on('uncaughtException', (err) => {
    console.error('CRITICAL ERROR:', err);
});
console.log("--- STARTING SERVER SCRIPT ---");

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors'); // Бібліотека для дозволів
const path = require('path');

// 1. Створюємо додаток Express
const app = express();

// 2. Налаштовуємо CORS для звичайних запитів (HTML, CSS)
// Дозволяємо всім (*) заходити на сайт
app.use(cors({ origin: '*' })); 

// 3. Вказуємо шлях до папки з грою (Vue)
const distPath = path.join(__dirname, '../client/dist');
console.log(`Serving static files from: ${distPath}`);
app.use(express.static(distPath));

// 4. Створюємо HTTP сервер
const server = http.createServer(app);

// 5. Налаштовуємо Socket.IO (Дзвінки)
const io = new Server(server, {
   cors: {
       origin: "*",  // Дозволяємо підключатися з будь-якого сайту/пристрою
       methods: ["GET", "POST"]
       // credentials: true <-- ПРИБРАЛИ ЦЕ, щоб не було конфлікту з "*"
   }
});

console.log("--- SOCKET.IO SETUP DONE ---");

// --- ТУТ ТВОЇ ФУНКЦІЇ ГРИ (checkShipStatus, isLoser) ---
// (Я їх тут скоротив, щоб не займати місце, але ТИ ЇХ ЗАЛИШ!)

let waitingPlayer = null;

// ФУНКЦІЇ ГРИ
function checkShipStatus(board, startX, startY) {
    const shipCoords = [];
    const stack = [{ x: startX, y: startY }];
    const visited = new Set();
    let isSunk = true;
    visited.add(`${startX},${startY}`);
    while (stack.length > 0) {
        const { x, y } = stack.pop();
        shipCoords.push({ x, y });
        const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;
            const key = `${nx},${ny}`;
            if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10 && !visited.has(key)) {
                const cell = board[ny][nx];
                if (cell === 1 || cell === 2) {
                    if (cell === 1) isSunk = false; 
                    visited.add(key);
                    stack.push({ x: nx, y: ny });
                }
            }
        }
    }
    return { isSunk, shipCoords };
}

function isLoser(board) {
    for (let row of board) {
        if (row.includes(1)) return false;
    }
    return true; 
}

// --- ЛОГІКА SOCKET.IO ---
io.on('connection', (socket) => {

   // --- ЧАТ ---
   socket.on('chat-message', (text) => {
      const room = socket.data.room;
      // Відправляємо повідомлення в кімнату. 
      // Додаємо senderId, щоб клієнт знав, чиє це повідомлення (моє чи ворога)
      if (room) {
         io.to(room).emit('chat-message', { 
            text: text, 
            senderId: socket.id 

         });
      }
   });
   console.log('Player connected:', socket.id); // <--- ЦЕ МИ МАЄМО ПОБАЧИТИ В ЛОГАХ

   if (waitingPlayer) {
      const player1 = waitingPlayer;
      const player2 = socket;
      waitingPlayer = null;

      const roomName = "room-" + player1.id;
      player1.join(roomName);
      player2.join(roomName);

      player1.data = { room: roomName, opponent: player2.id, ready: false };
      player2.data = { room: roomName, opponent: player1.id, ready: false };

      io.to(roomName).emit('status-update', 'Opponent found. Deploy ships!');
      io.to(roomName).emit('setup-phase');

   } else {
      waitingPlayer = socket;
      socket.emit('status-update', 'Waiting for opponent...');
   }

   socket.on('player-ready', (myShipsMatrix) => {
      // ... Твій код player-ready ...
      socket.data.ships = JSON.parse(JSON.stringify(myShipsMatrix));
      socket.data.ready = true;
      const opponentSocket = io.sockets.sockets.get(socket.data.opponent);
      if (opponentSocket && opponentSocket.data.ready) {
          const p1Starts = Math.random() > 0.5;
          socket.emit('game-start', { turn: p1Starts });
          opponentSocket.emit('game-start', { turn: !p1Starts });
      } else {
          socket.emit('status-update', 'Waiting for opponent to place ships...');
      }
   });

   socket.on('fire', ({ x, y }) => {
      // ... Твій код fire ...
      const room = socket.data.room;
      if (!room) return;
      const opponentId = socket.data.opponent;
      const opponentSocket = io.sockets.sockets.get(opponentId);
      if (!opponentSocket) return;

      const board = opponentSocket.data.ships;
      const cellValue = board[y][x];

      let result = 'miss';
      let sunkCoords = null;

      if (cellValue === 1) {
         result = 'hit';
         board[y][x] = 2;
         const check = checkShipStatus(board, x, y);
         if (check.isSunk) {
            result = 'killed';
            sunkCoords = check.shipCoords;
         }
      } else if (cellValue === 0) {
         board[y][x] = 3;
      }

      const payload = { x, y, result, sunkCoords };
      socket.emit('fire-result', payload);
      opponentSocket.emit('enemy-fire', payload);

      if (result === 'hit' || result === 'killed') {
          if (isLoser(board)) {
              io.to(room).emit('game-over', { winner: socket.id });
              return;
          }
      }
      if (result === 'miss') {
         socket.emit('turn-change', false);
         opponentSocket.emit('turn-change', true);
      }
   });

   socket.on('disconnect', () => {
       console.log('Player disconnected:', socket.id);
       if (waitingPlayer === socket) waitingPlayer = null;
       if (socket.data.room) {
           socket.to(socket.data.room).emit('game-over', { winner: 'OPPONENT_LEFT' }); 
       }
   });
});

// 6. Фінальний маршрут (Запасний вихід)
// Якщо нічого не знайдено, віддаємо index.html
app.use((req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// 7. ЗАПУСК
const PORT = process.env.PORT || 4000;
server.listen(PORT, '0.0.0.0', () => {
   console.log(`SERVER RUNNING ON PORT ${PORT}`);
   console.log("--- READY FOR CONNECTION ---");
});

// Ловимо критичні помилки
process.on('uncaughtException', (err) => {
    console.error('CRITICAL ERROR:', err);
});
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Вказуємо шлях до папки dist (через .., бо ми всередині папки server)
app.use(express.static(path.join(__dirname, '../dist')));

const server = http.createServer(app);
const io = new Server(server, {
   cors: { origin: "*", methods: ["GET", "POST"] }
});

let waitingPlayer = null;

// --- ДОПОМІЖНІ ФУНКЦІЇ ---

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


// --- ОСНОВНА ЛОГІКА SOCKET.IO ---

io.on('connection', (socket) => {
   console.log('Підключився:', socket.id);

   if (waitingPlayer) {
      const player1 = waitingPlayer;
      const player2 = socket;
      waitingPlayer = null;

      const roomName = "room-" + player1.id;
      player1.join(roomName);
      player2.join(roomName);

      player1.data = { room: roomName, opponent: player2.id, ready: false };
      player2.data = { room: roomName, opponent: player1.id, ready: false };

      io.to(roomName).emit('status-update', 'Суперника знайдено. Розстав кораблі!');
      io.to(roomName).emit('setup-phase');

   } else {
      waitingPlayer = socket;
      socket.emit('status-update', 'Чекаємо на суперника...');
   }

   socket.on('player-ready', (myShipsMatrix) => {
      socket.data.ships = JSON.parse(JSON.stringify(myShipsMatrix));
      socket.data.ready = true;
      
      const opponentSocket = io.sockets.sockets.get(socket.data.opponent);
      if (opponentSocket && opponentSocket.data.ready) {
          const p1Starts = Math.random() > 0.5;
          socket.emit('game-start', { turn: p1Starts });
          opponentSocket.emit('game-start', { turn: !p1Starts });
      } else {
          socket.emit('status-update', 'Чекаємо, поки суперник розставить кораблі...');
      }
   });

   socket.on('fire', ({ x, y }) => {
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
       if (waitingPlayer === socket) waitingPlayer = null;
       if (socket.data.room) {
           socket.to(socket.data.room).emit('game-over', { winner: 'OPPONENT_LEFT' }); 
       }
   });
});


// !!! ОСЬ ТУТ МИ ВСТАВЛЯЄМО ТОЙ КОД !!!
// Це означає: "Якщо запит не попав ні в сокети, ні в файли - віддай index.html"
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});


// !!! ВАЖЛИВО: Оновлений запуск порту для Render !!!
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
   console.log(`SERVER RUNNING ON PORT ${PORT}`);
});
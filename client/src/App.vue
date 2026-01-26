<script setup>
import { ref, onMounted } from 'vue'; // імпортую шнструменти з Vue. ref - для реактивних змінних, onMounted - для дій при монтуванні компонента
import { io } from "socket.io-client"; // імпортую бібліотеку socket.io-client
import { generateShips } from './shipGenerator'; // імпортую генератор кораблів зі свого файлу
import GameChat from './components/GameChat.vue'; // імпортую компонент чату

// підключення до локального сервера і до хостингу Render.com
// 1. Отримуємо адресу, на якій відкрито сайт (localhost, 192.168.x.x або onrender.com)
const hostname = window.location.hostname;
const protocol = window.location.protocol;

// 2. Перевіряємо, чи ми на Render (у продакшні)
const isProduction = hostname.includes('onrender.com');

// 3. Формуємо адресу для Socket.io
// Якщо render -> undefined (автоматично)
// Якщо дім (Wi-Fi/Localhost) -> беремо ТОЙ САМИЙ IP, але стукаємо в порт 4000
const socketUrl = isProduction ? undefined : `${protocol}//${hostname}:4000`;

const socket = io(socketUrl, {
  transports: ['websocket', 'polling'],
  reconnection: true
});

const status = ref('Connecting...');
const gameStage = ref('waiting'); // спочатку показує waiting -> setup -> playing -> finished
const playerBoard = ref([]); // моя карта бою з порожніми масивами
const enemyBoard = ref([]); // ворожа карта бою з порожніми масивами
const isMyTurn = ref(false); // показує, чи мій зараз хід
const isReady = ref(false); // чи натиснула я кнопку 'готовий'
const winner = ref(null); // null, 'ME', 'ENEMY'
const isSoundOn = ref(true);

// Чат живе тут (масив повідомлень)
const chatMessages = ref([]);

const createEmptyBoard = () => Array(10).fill().map(() => Array(10).fill(0)); // функція створення сітки 10х10

const audioFiles = {
  useron: new Audio('/sounds/userOn.mp3'),
  go: new Audio('/sounds/go.mp3'),
  miss: new Audio('/sounds/miss.mp3'),
  hit: new Audio('/sounds/hit.mp3'),
  win: new Audio('/sounds/win.mp3'),
  lose: new Audio('/sounds/lose.mp3'),
  mix: new Audio('/sounds/mix.mp3'),
  allShip: new Audio('/sounds/allShip.mp3'),
  sent: new Audio('/sounds/sent.mp3'),
  accept: new Audio('/sounds/accept.mp3'),
};

const toggleSound = () => {
  isSoundOn.value = !isSoundOn.value;
};

// функція для програвання
const playSound = (name) => {
  if (!isSoundOn.value) return; // Якщо звук вимкнено — нічого не робимо
  const sound = audioFiles[name];
  if (sound) {
    sound.currentTime = 0; // перемотати на початок (якщо звук ще грає)
    sound.play().catch(err => console.log("Браузер заблокував звук:", err));
  }
};

// Функція обробки відправки повідомлення (викликається компонентом GameChat)
const handleSendMessage = (text) => {
  socket.emit('chat-message', text);
  playSound('accept');
};

// функція для автоматичного зафарбовування клітинок навколо вбитого корабля
const markSurrounding = (board, sunkCoords) => {
  sunkCoords.forEach(coord => {
    // Перебираємо всі 8 клітинок навколо кожної палуби
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ny = coord.y + dy;
        const nx = coord.x + dx;

        // Перевіряємо, щоб не вилізти за межі карти (0-9)
        if (ny >= 0 && ny < 10 && nx >= 0 && nx < 10) {
          // Якщо клітинка порожня (0) — ставимо "промах" (3)
          if (board[ny][nx] === 0) {
            board[ny][nx] = 3;
          }
        }
      }
    }
  });
};

// створюю порожні ігрові поля
playerBoard.value = createEmptyBoard();
enemyBoard.value = createEmptyBoard();

onMounted(() => {
  // Коли приходить повідомлення чату
  socket.on('chat-message', ({ text, senderId }) => {
    chatMessages.value.push({
      text: text,
      isMe: senderId === socket.id // Перевіряємо, чи це я написала
    });

    if (senderId !== socket.id) {
      playSound('sent');
    }
  });

  // Якщо з'єднання пройшло успішно
  socket.on('connect', () => {
    console.log("Успішне з'єднання з ID:", socket.id);
    if (status.value.includes('помилка')) {
      status.value = "З'єднано! Чекаємо на дані гри...";
    }
  });

  // Якщо сталася помилка з'єднання
  socket.on('connect_error', (err) => {
    console.error("Помилка з'єднання:", err);
    status.value = "Помилка з'єднання: " + err.message;
  });

  socket.on('status-update', (msg) => status.value = msg);

  // Етап розстановки
  socket.on('setup-phase', () => {
    gameStage.value = 'setup';
    playSound('useron');
    randomizeShips(true); // Одразу даємо випадкову карту
  });

  // Етап гри
  socket.on('game-start', (data) => {
    gameStage.value = 'playing';
    isMyTurn.value = data.turn;

    if (isMyTurn.value) {
      status.value = "The battle has begun! It's your turn";
    } else {
      status.value = "The battle has begun! It's the opponent's turn.";
    }
  });

  // Коли стріляю Я
  socket.on('fire-result', ({ x, y, result, sunkCoords }) => {
    console.log(`Server responded: ${result}`);

    if (result === 'killed') {
      sunkCoords.forEach(coord => {
        enemyBoard.value[coord.y][coord.x] = 4; // 4 = KILLED
        playSound('allShip');
      });
      markSurrounding(enemyBoard.value, sunkCoords);
      status.value = "SHIP DESTROYED! Shoot again!";
    }
    else if (result === 'hit') {
      enemyBoard.value[y][x] = 2; // 2 = HIT
      status.value = "Hit! Shoot again!";
      playSound('hit');
    }
    else {
      enemyBoard.value[y][x] = 3; // 3 = MISS
      status.value = "Miss...";
      playSound('miss');
    }
  });

  // Коли стріляє ВОРОГ по мені
  socket.on('enemy-fire', ({ x, y, result, sunkCoords }) => {
    if (result === 'killed') {
      sunkCoords.forEach(coord => {
        playerBoard.value[coord.y][coord.x] = 4;
      });
      markSurrounding(playerBoard.value, sunkCoords);
      playSound('allShip');
    }
    else if (result === 'hit') {
      playerBoard.value[y][x] = 2;
      playSound('hit');
    }
    else {
      playerBoard.value[y][x] = 3;
      playSound('miss');
    }
  });

  socket.on('turn-change', (myTurn) => {
    isMyTurn.value = myTurn;
    status.value = myTurn ? "Your turn!" : "Opponent's turn...";
  });

  socket.on('game-over', (data) => {
    gameStage.value = 'finished';
    if (data.winner === socket.id) {
      winner.value = 'ME';
      status.value = "WINNER";
      playSound('win');
    } else {
      winner.value = 'ENEMY';
      status.value = "YOU LOST...";
      playSound('lose');
    }
  });
});

// кнопка 'перемішати кораблі'
const randomizeShips = (silent = false) => {
  if (isReady.value) return;
  playerBoard.value = generateShips();
  if (silent !== true) {
    playSound('mix');
  }
};

// кнопка 'готова до бою'
const confirmShips = () => {
  isReady.value = true;
  status.value = "Чекаю на готовність суперника...";
  socket.emit('player-ready', playerBoard.value);
  playSound('go');
};

// функція стрільби по ворожому полю
const fire = (x, y) => {
  if (gameStage.value !== 'playing') return;
  if (!isMyTurn.value) return;
  if (enemyBoard.value[y][x] !== 0) return;
  socket.emit('fire', { x, y });
}
</script>

<template>
  <div class="game-container">
    <button class="sound-control" @click="toggleSound" :title="isSoundOn ? 'Вимкнути звук' : 'Увімкнути звук'">
      <span v-if="isSoundOn">🔊</span>
      <span v-else>🔇</span>
    </button>
    <h1>Sea Battle: online</h1>

    <div class="status-panel" :class="{ 'active-turn': isMyTurn && gameStage === 'playing' }">
      <h2>{{ status }}</h2>
    </div>

    <div v-if="gameStage === 'setup'" class="controls">
      <button @click="randomizeShips" :disabled="isReady" class="btn random">Mix</button>
      <button @click="confirmShips" :disabled="isReady" class="btn ready">Ready for battle!</button>
    </div>

    <div class="container">
      <div class="board-block">
        <h3>My fleet</h3>
        <div class="board">
          <div v-for="(row, y) in playerBoard" :key="y" class="row">
            <div v-for="(cell, x) in row" :key="x" class="cell" :class="{
              'ship': cell === 1,
              'hit': cell === 2,
              'miss': cell === 3,
              'killed': cell === 4
            }"></div>
          </div>
        </div>
      </div>

      <div class="board-block" v-if="gameStage === 'playing'">
        <h3>Enemy waters</h3>
        <div class="board enemy-board" :class="{ 'disabled': !isMyTurn }">
          <div v-for="(row, y) in enemyBoard" :key="y" class="row">
            <div v-for="(cell, x) in row" :key="x" class="cell" :class="{
              'hit': cell === 2,
              'miss': cell === 3,
              'killed': cell === 4
            }" @click="fire(x, y)"></div>
          </div>
        </div>
      </div>
    </div>

    <GameChat :messages="chatMessages" @send-message="handleSendMessage" />

    <div v-if="gameStage === 'finished'" class="modal-overlay">
      <div class="modal-content" :class="{ 'win': winner === 'ME', 'lose': winner === 'ENEMY' }">
        <h1 v-if="winner === 'ME'">WINNER</h1>
        <h1 v-else>LOSE</h1>
        <p v-if="winner === 'ME'">All enemy ships destroyed!</p>
        <p v-else>Your fleet has sunk</p>
        <button class="btn" onclick="location.reload()">Play again</button>
      </div>
    </div>
  </div>
</template>
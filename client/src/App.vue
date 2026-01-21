<script setup>
import { ref, onMounted, watch, nextTick } from 'vue'; // імпортую шнструменти з Vue. ref - для реактивних змінних, onMounted - для дій при монтуванні компонента
import { io } from "socket.io-client"; // імпортую бібліотеку socket.io-client. io - функція для підключення до сервера з швидкою WebSocket-підтримкою (живий зв'язок)
import { generateShips } from './shipGenerator'; // імпортую генератор кораблів зі свого файлу

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

// --- ЧАТ ---
const chatMessages = ref([]); // Тут зберігаємо історію
const newMessage = ref('');   // Тут текст, який ми пишемо
const chatWindowRef = ref(null);

const sendMessage = () => {
  if (newMessage.value.trim() === '') return; // Не відправляємо порожній текст

  // Відправляємо на сервер
  socket.emit('chat-message', newMessage.value);
  playSound('accept'); // Звук відправки повідомлення

  newMessage.value = ''; // Очищаємо поле вводу
};

const status = ref('Підключення...');
const gameStage = ref('waiting'); // спочатку показує waiting -> setup -> playing -> finished
const playerBoard = ref([]); // моя карта бою з порожніми масивами
const enemyBoard = ref([]); // ворожа карта бою з порожніми масивами
const isMyTurn = ref(false); // показує, чи мій зараз хід
const isReady = ref(false); // чи натиснула я кнопку 'готовий'
const winner = ref(null); // null, 'ME', 'ENEMY'
// const socket = io();  підключення до сервера (тут IP мого локального сервера)
const createEmptyBoard = () => Array(10).fill().map(() => Array(10).fill(0)); // функція створення сітки 10х10. Масив масивів, поки що заповнених нулями
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

watch(chatMessages, async () => {
  // Чекаємо, поки Vue оновить DOM (намалює нове повідомлення)
  await nextTick();

  // Якщо вікно існує — крутимо його в самий низ
  if (chatWindowRef.value) {
    chatWindowRef.value.scrollTop = chatWindowRef.value.scrollHeight;
  }
}, { deep: true });

// функція для програвання
const playSound = (name) => {
  const sound = audioFiles[name];
  if (sound) {
    sound.currentTime = 0; // перемотати на початок (якщо звук ще грає)
    sound.play().catch(err => console.log("Браузер заблокував звук:", err));
  }
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
          // Ми не чіпаємо сам корабель (там буде 4) або вже стріляні клітинки
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

    // Якщо сервер мовчить, ми хоча б знаємо, що з'єдналися
    if (status.value.includes('помилка')) {
      status.value = "З'єднано! Чекаємо на дані гри...";
    }
  });

  // Якщо сталася помилка з'єднання (найважливіше!)
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
      status.value = "Бій почався! Твій хід!";
    } else {
      status.value = "Бій почався! Хід суперника.";
    }
  });

  // Коли стріляю Я
  socket.on('fire-result', ({ x, y, result, sunkCoords }) => {
    console.log(`Сервер відповів: ${result}`);

    if (result === 'killed') {
      // Якщо вбили корабель - фарбуємо всі його частини
      sunkCoords.forEach(coord => {
        enemyBoard.value[coord.y][coord.x] = 4; // 4 = KILLED
        playSound('allShip');
      });
      markSurrounding(enemyBoard.value, sunkCoords);
      status.value = "КОРАБЕЛЬ ЗНИЩЕНО! Стріляй ще!";
    }
    else if (result === 'hit') {
      // Звичайне влучання
      enemyBoard.value[y][x] = 2; // 2 = HIT
      status.value = "Влучила! Стріляй ще!";
      playSound('hit');
    }
    else {
      // Промах
      enemyBoard.value[y][x] = 3; // 3 = MISS
      status.value = "Промах...";
      playSound('miss');
    }
  });

  // Коли стріляє ВОРОГ по мені
  socket.on('enemy-fire', ({ x, y, result, sunkCoords }) => {
    // 1. Якщо корабель ВБИТО
    if (result === 'killed') {
      sunkCoords.forEach(coord => {
        playerBoard.value[coord.y][coord.x] = 4;
      });
      markSurrounding(playerBoard.value, sunkCoords);
      playSound('allShip'); // Звук знищення цілого корабля
    }
    // 2. Якщо просто ВЛУЧАННЯ (але корабель ще живий)
    else if (result === 'hit') {
      playerBoard.value[y][x] = 2; // Малюємо червоний хрестик
      playSound('hit');
    }
    // 3. Якщо ПРОМАХ
    else {
      playerBoard.value[y][x] = 3; // Малюємо крапку
      playSound('miss');           // Звук "бульк"
    }
  });

  socket.on('turn-change', (myTurn) => {
    isMyTurn.value = myTurn;
    status.value = myTurn ? "Твій хід!" : "Хід суперника...";
  });

  socket.on('game-over', (data) => {
    gameStage.value = 'finished'; // Новий статус гри

    // Перевіряємо, чий ID прийшов як переможець
    if (data.winner === socket.id) {
      winner.value = 'ME';
      status.value = "ПЕРЕМОГА!";
      playSound('win');
    } else {
      winner.value = 'ENEMY';
      status.value = "ТИ ПРОГРАЛА...";
      playSound('lose');
    }
  });
});

// кнопка 'перемішати кораблі'
// Ми додали параметр (silent = false). За замовчуванням він "брехня", тобто звук БУДЕ.
const randomizeShips = (silent = false) => {
  if (isReady.value) return;
  playerBoard.value = generateShips();

  // Граємо звук ТІЛЬКИ якщо нам не наказали мовчати (silent !== true)
  if (silent !== true) {
    playSound('mix');
  }
};

// кнопка 'готова до бою'
const confirmShips = () => {
  isReady.value = true;
  status.value = "Чекаю на готовність суперника...";
  socket.emit('player-ready', playerBoard.value); // відправляю на сервер мою карту бою, socket.emit (говоримо серверу)
  playSound('go');
};

// функція стрільби по ворожому полю
const fire = (x, y) => { // отримує координати клітинки
  if (gameStage.value !== 'playing') return; // якщо гра не в стадії гри, не стріляємо (заблокована карта)
  if (!isMyTurn.value) return; // якщо не мій хід, не стріляємо (заблокована карта)
  if (enemyBoard.value[y][x] !== 0) return;
  socket.emit('fire', { x, y });
}
</script>

<template>
  <div class="game-container">
    <h1>Sea Battle: Online</h1>

    <div class="status-panel" :class="{ 'active-turn': isMyTurn && gameStage === 'playing' }">
      <h2>{{ status }}</h2>
    </div>

    <div v-if="gameStage === 'setup'" class="controls">
      <button @click="randomizeShips" :disabled="isReady" class="btn random">Перемішати</button>
      <button @click="confirmShips" :disabled="isReady" class="btn ready">Готовий до бою!</button>
    </div>

    <div class="container">
      <div class="board-block">
        <h3>Мій флот</h3>
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
        <h3>Ворожі води</h3>
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
    <div v-if="gameStage === 'finished'" class="modal-overlay">
      <div class="modal-content" :class="{ 'win': winner === 'ME', 'lose': winner === 'ENEMY' }">
        <h1 v-if="winner === 'ME'">ТИ ПЕРЕМОГЛА!</h1>
        <h1 v-else>ТИ ПРОГРАЛА</h1>

        <p v-if="winner === 'ME'">Всі ворожі кораблі знищено!</p>
        <p v-else>Твій флот пішов на дно.</p>

        <button class="btn" onclick="location.reload()">Зіграти ще раз</button>
      </div>
    </div>

    <div class="chat-container">
      <h3>Чат</h3>
      <div class="chat-window" ref="chatWindowRef">
        <div v-for="(msg, index) in chatMessages" :key="index" class="message"
          :class="{ 'my-message': msg.isMe, 'opponent-message': !msg.isMe }">
          {{ msg.text }}
        </div>
      </div>
      <div class="chat-input">
        <input v-model="newMessage" @keyup.enter="sendMessage" placeholder="Написати повідомлення..." />
        <button @click="sendMessage">➤</button>
      </div>
    </div>
  </div>
</template>

<style>
body,
html,
#app {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow-x: hidden;
}
</style>

<style scoped>
.game-container {
  font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  padding: 20px;
  background-color: #e3f2fd;
  min-height: 100vh;
  width: 100%;
  color: #333;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

h1 {
  margin-bottom: 15px;
  font-size: 2.5rem;
  color: #1565c0;
}

h2 {
  margin: 0;
  font-size: 1.4rem;
}

h3 {
  margin-bottom: 15px;
  font-size: 1.2rem;
  color: #546e7a;
}

/* Панель статусу */
.status-panel {
  text-align: center;
  margin-bottom: 25px;
  padding: 15px 25px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  min-width: 300px;
  transition: all 0.3s ease;
}

.active-turn {
  background-color: #e8f5e9;
  color: #2e7d32;
  border: 2px solid #a5d6a7;
  transform: scale(1.05);
}

/* --- СТИЛІ ЧАТУ --- */
.chat-container {
  margin-top: 30px;
  width: 100%;
  max-width: 300px;
  /* Ширина чату */
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  border: 2px solid #90caf9;
}

.chat-container h3 {
  background-color: #1565c0;
  color: white;
  margin: 0;
  padding: 10px;
  text-align: center;
  font-size: 1rem;
}

.chat-window {
  height: 150px;
  /* Висота вікна повідомлень */
  overflow-y: auto;
  /* Прокрутка */
  padding: 15px;
  background-color: #f5f5f5;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scroll-behavior: smooth;
}

.message {
  max-width: 80%;
  padding: 8px 12px;
  border-radius: 15px;
  font-size: 0.9rem;
  word-wrap: break-word;
}

/* Мої повідомлення (справа, сині) */
.my-message {
  align-self: flex-end;
  background-color: #bbdefb;
  color: #0d47a1;
  border-bottom-right-radius: 2px;
}

/* Повідомлення ворога (зліва, білі) */
.opponent-message {
  align-self: flex-start;
  background-color: white;
  border: 1px solid #ddd;
  border-bottom-left-radius: 2px;
}

.chat-input {
  display: flex;
  border-top: 1px solid #ddd;
}

.chat-input input {
  flex: 1;
  padding: 12px;
  border: none;
  outline: none;
}

.chat-input button {
  background-color: #4caf50;
  color: white;
  border: none;
  padding: 0 20px;
  cursor: pointer;
  font-size: 1.2rem;
}

.chat-input button:hover {
  background-color: #388e3c;
}

/* Кнопки */
.controls {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-bottom: 30px;
}

.btn {
  padding: 12px 24px;
  font-size: 16px;
  font-weight: bold;
  cursor: pointer;
  border: none;
  border-radius: 8px;
  color: white;
  transition: all 0.2s;
  box-shadow: 0 4px 0 rgba(0, 0, 0, 0.2);
}

.btn:active:not(:disabled) {
  transform: translateY(4px);
  box-shadow: none;
}

.btn:disabled {
  background-color: #b0bec5;
  cursor: not-allowed;
  box-shadow: none;
}

.random {
  background-color: #ff9800;
}

.random:hover:not(:disabled) {
  background-color: #f57c00;
}

.ready {
  background-color: #4caf50;
}

.ready:hover:not(:disabled) {
  background-color: #388e3c;
}

/* ігрові поля */
.container {
  display: flex;
  justify-content: space-around;
  flex-wrap: wrap;
  gap: 40px;
  width: 100%;
  max-width: 1200px;
}

.board-block {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.board {
  display: flex;
  flex-direction: column;
  border: 4px solid #37474f;
  background-color: #bbdefb;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.15);
  border-radius: 4px;
}

.row {
  display: flex;
}

/* КЛІТИНКА (Базовий стиль) */
.cell {
  width: 35px;
  height: 35px;
  border: 1px solid #90caf9;
  background-color: rgba(255, 255, 255, 0.4);
  transition: all 0.2s;
  position: relative;
  /* Важливо для малювання хрестиків */
}

/* --- ЛОГІКА ВІДОБРАЖЕННЯ --- */

/* 1. Корабель (Тільки на моєму полі видно колір) */
.ship {
  background-color: #37474f !important;
  border-color: #263238;
}

/* 2. Промах (Сіра крапка) */
.miss {
  background-color: #cfd8dc !important;
}

.miss::after {
  content: '•';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #546e7a;
  font-size: 24px;
  line-height: 0;
}

/* 3. Влучання (Червоний фон + Білий хрестик) */
.hit {
  background-color: #ef5350 !important;
}

.hit::after {
  content: '✕';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: white;
  font-weight: bold;
  font-size: 20px;
  line-height: 0;
}

/* 4. ВБИТИЙ (Темний фон + Великий червоний хрест) */
/* --- ОНОВЛЕНИЙ ДИЗАЙН ВБИТОГО КОРАБЛЯ --- */

/* 4. ВБИТИЙ КОРАБЕЛЬ */
.killed {
  /* Робимо колір корабля дуже темним, майже чорним, як згорілий метал */
  background-color: #1a1a1a !important;
  border-color: #000;
  /* Додаємо внутрішню тінь, щоб він здавався "вдавленим" у воду */
  box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.8);
  z-index: 1;
}

/* Малюємо ВЕЛИКИЙ, чіткий червоний хрест */
.killed::after {
  content: '✕';
  /* Використовуємо жирний символ замість градієнта */
  position: absolute;
  top: 50%;
  left: 50%;
  /* Центруємо і трохи збільшуємо розмір шрифту */
  transform: translate(-50%, -50%) scale(1.2);

  color: #ff3333;
  /* Яскравий червоний */
  font-weight: 900;
  /* Максимальна жирність */
  font-size: 34px;
  /* Розмір на всю клітинку */

  /* Додаємо невелику тінь тексту для об'єму */
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.6);
  z-index: 2;
}

/* Специфіка ворожого поля */
.enemy-board .cell {
  cursor: crosshair;
}

.enemy-board .cell:hover:not(.hit):not(.miss):not(.killed) {
  background-color: rgba(255, 235, 59, 0.6);
}

.enemy-board.disabled {
  opacity: 0.7;
  pointer-events: none;
  filter: grayscale(80%);
}

/* --- МОДАЛЬНЕ ВІКНО РЕЗУЛЬТАТУ --- */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.7);
  /* Темний фон */
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 100;
  backdrop-filter: blur(5px);
  /* Розмиття фону */
}

.modal-content {
  background: white;
  padding: 40px;
  border-radius: 20px;
  text-align: center;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  border: 5px solid;
  max-width: 400px;
}

/* Стиль для перемоги */
.modal-content.win {
  border-color: #ffd700;
  /* Золотий */
  background: linear-gradient(to bottom, #fff, #fffde7);
}

.modal-content.win h1 {
  color: #f39c12;
}

/* Стиль для поразки */
.modal-content.lose {
  border-color: #444;
  background: linear-gradient(to bottom, #fff, #eceff1);
}

.modal-content.lose h1 {
  color: #2c3e50;
}

@keyframes popIn {
  0% {
    transform: scale(0.5);
    opacity: 0;
  }

  100% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
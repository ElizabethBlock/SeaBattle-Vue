<script setup>
import { ref, onMounted } from 'vue'; // імпортую шнструменти з Vue. ref - для реактивних змінних, onMounted - для дій при монтуванні компонента
import { io } from "socket.io-client"; // імпортую бібліотеку socket.io-client
import { generateShips } from './shipGenerator'; // імпортую генератор кораблів зі свого файлу
import GameChat from './components/GameChat.vue'; // імпортую компонент чату

const hostname = window.location.hostname;// підключення до локального сервера і до хостингу Render.com
const protocol = window.location.protocol;// отримую адресу, на якій відкрито сайт (localhost, 192.168.x.x або onrender.com)
const isProduction = hostname.includes('onrender.com'); // перевіряю, чи ми на Render (у продакшні)
const socketUrl = isProduction ? undefined : `${protocol}//${hostname}:4000`;// формую адресу для Socket.io. Якщо render -> undefined (автоматично). Якщо дім (Wi-Fi/Localhost) -> беремо ТОЙ САМИЙ IP, але стукаємо в порт 4000

// підключення двох способів зв'язку. Вебсокети (миттєві повідомлення) і полінг (резервний варіант, браузер почне дуже часто питати сервер про новини, при поганому інтернеті)
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
const hitStatus = ref(null); // 'hit', 'killed' або null
const isFiringBlocked = ref(false); // за замовчуванням стрільба дозволена
const isSoundOn = ref(true); // звук увімкнено за замовчуванням
const chatMessages = ref([]); // чат тут (масив повідомлень)
const createEmptyBoard = () => Array(10).fill().map(() => Array(10).fill(0)); // функція створення сітки 10х10
let hitStatusTimer = null; // тут ми будемо тримати "пульт керування" таймером

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

// функція для перемикання звуку
const toggleSound = () => {
  isSoundOn.value = !isSoundOn.value;
};

// функція для програвання
const playSound = (name) => {
  if (!isSoundOn.value) return; // Якщо звук вимкнено — нічого не робимо
  const sound = audioFiles[name];
  if (sound) {
    sound.currentTime = 0; // перемотати на початок (якщо звук ще грає)
    sound.play().catch(err => console.log("Browser blocked sound:", err));
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
    console.log("Successful connection with ID:", socket.id);
    if (status.value.includes('error')) {
      status.value = "Connected! Waiting for game data...";
    }
  });

  // Якщо сталася помилка з'єднання
  socket.on('connect_error', (err) => {
    console.error("Connection error:", err);
    status.value = "Connection error: " + err.message;
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

  // Коли стріляю я по ворогу
  socket.on('fire-result', ({ x, y, result, sunkCoords }) => {
    console.log(`Server responded: ${result}`);

    // 1. Очищуємо старий таймер, якщо він є
    if (hitStatusTimer) clearTimeout(hitStatusTimer);

    if (result === 'killed') {
      sunkCoords.forEach(coord => {
        enemyBoard.value[coord.y][coord.x] = 4;
      });
      markSurrounding(enemyBoard.value, sunkCoords);
      playSound('allShip');

      // Встановлюємо статус успіху (знищення)
      hitStatus.value = 'success-killed';
    }
    else if (result === 'hit') {
      enemyBoard.value[y][x] = 2;
      playSound('hit');

      // Встановлюємо статус успіху (влучання)
      hitStatus.value = 'success-hit';
    }
    else {
      enemyBoard.value[y][x] = 3;
      status.value = "Miss..."; // Для промаху залишаємо звичайний статус
      playSound('miss');
      hitStatus.value = null; // Прибираємо кольорову плашку, якщо вона була
    }

    // 2. Якщо було влучання або вбивство — запускаємо таймер на 5 секунд
    if (result === 'hit' || result === 'killed') {
      hitStatusTimer = setTimeout(() => {
        hitStatus.value = null;
        hitStatusTimer = null;
        // Тільки після 4 секунд повертаємо текст про хід
        status.value = "Your turn! Shoot again!";
      }, 4000);
    }

    setTimeout(() => {
      isFiringBlocked.value = false;
    }, 500);
  });

  // Коли стріляє ВОРОГ по мені
  socket.on('enemy-fire', ({ x, y, result, sunkCoords }) => {
    // 1. Очищуємо старий таймер
    if (hitStatusTimer) clearTimeout(hitStatusTimer);

    if (result === 'killed') {
      playerBoard.value[y][x] = 4;
      sunkCoords.forEach(coord => playerBoard.value[coord.y][coord.x] = 4);
      markSurrounding(playerBoard.value, sunkCoords);
      playSound('allShip');

      hitStatus.value = 'killed';
    }
    else if (result === 'hit') {
      playerBoard.value[y][x] = 2;
      playSound('hit');

      hitStatus.value = 'hit';
    }
    else {
      // Якщо ворог промахнувся, можна прибрати червону плашку (якщо вона висіла від минулого разу)
      playerBoard.value[y][x] = 3;
      playSound('miss');
      hitStatus.value = null;
    }

    // 2. Запускаємо новий таймер на 4 секунди
    if (result === 'hit' || result === 'killed') {
      hitStatusTimer = setTimeout(() => {
        hitStatus.value = null;
        hitStatusTimer = null;
      }, 4000);
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
  status.value = "Waiting for opponent's readiness...";
  socket.emit('player-ready', playerBoard.value);
  playSound('go');
};

// функція стрільби по ворожому полю
const fire = (x, y) => {
  if (gameStage.value !== 'playing') return;
  if (!isMyTurn.value) return;
  if (enemyBoard.value[y][x] !== 0) return;
  if (isFiringBlocked.value) return;
  socket.emit('fire', { x, y });
  isFiringBlocked.value = true;
}
</script>

<template>
  <div class="game-container">
    <button class="sound-control" @click="toggleSound" :title="isSoundOn ? 'Turn off sound' : 'Turn on sound'">
      <span v-if="isSoundOn">🔊</span>
      <span v-else>🔇</span>
    </button>
    <h1>Sea Battle: online</h1>

    <div class="status-panel" :class="{
      'active-turn': isMyTurn && gameStage === 'playing',
      'status-hit': hitStatus === 'hit',
      'status-killed': hitStatus === 'killed',
      'status-success': hitStatus === 'success-hit' || hitStatus === 'success-killed'
    }">
      <h2 v-if="hitStatus === 'hit'">YOU'RE HIT!</h2>
      <h2 v-else-if="hitStatus === 'killed'">YOUR SHIP DESTROYED!</h2>
      <h2 v-else-if="hitStatus === 'success-hit'">NICE SHOT!</h2>
      <h2 v-else-if="hitStatus === 'success-killed'">ENEMY SHIP SUNK!</h2>
      <h2 v-else>{{ status }}</h2>
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
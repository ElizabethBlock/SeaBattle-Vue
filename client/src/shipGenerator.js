const SHIP_SIZES = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];

export function generateShips() {
  const board = Array(10).fill().map(() => Array(10).fill(0));

  for (const size of SHIP_SIZES) {
    let placed = false;
    while (!placed) {
      const direction = Math.random() > 0.5 ? 'H' : 'V';
      const x = Math.floor(Math.random() * 10);
      const y = Math.floor(Math.random() * 10);

      if (canPlaceShip(board, x, y, size, direction)) {
        placeShip(board, x, y, size, direction);
        placed = true;
      }
    }
  }
  return board;
}

function canPlaceShip(board, x, y, size, direction) {
   // перевіряємо межі поля
  if (direction === 'H' && x + size > 10) return false;
  if (direction === 'V' && y + size > 10) return false;

  // щоб кораблі не торкались
  for (let i = 0; i < size; i++) {
    const curX = direction === 'H' ? x + i : x;
    const curY = direction === 'V' ? y + i : y;

    // перевіряємо клітинку і всіх її сусідів
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = curX + dx;
        const ny = curY + dy;
        if (nx >= 0 && nx < 10 && ny >= 0 && ny < 10) {
          if (board[ny][nx] === 1) return false;
        }
      }
    }
  }
  return true;
}

function placeShip(board, x, y, size, direction) {
  for (let i = 0; i < size; i++) {
    const curX = direction === 'H' ? x + i : x;
    const curY = direction === 'V' ? y + i : y;
    board[curY][curX] = 1;
  }
}

/*
 * ui.js — Board rendering and interaction.
 *
 * Wires the Chess engine and minimax AI to the DOM: draws the board, handles
 * click-to-move, runs the AI for the opponent, and manages game flow
 * (promotion choice, status messages, new game, undo, difficulty).
 */

const UNICODE = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};

// Search depth per difficulty level.
const DIFFICULTY_DEPTH = { easy: 2, medium: 3, hard: 4 };

class GameUI {
  constructor() {
    this.game = new Chess();
    this.boardEl = document.getElementById('board');
    this.statusEl = document.getElementById('status');
    this.movesEl = document.getElementById('moves');
    this.capturedWhiteEl = document.getElementById('captured-white');
    this.capturedBlackEl = document.getElementById('captured-black');

    this.humanColor = WHITE; // human plays White by default
    this.difficulty = 'medium';
    this.selected = null; // [row, col] of selected piece
    this.legalForSelected = [];
    this.thinking = false;
    this.gameOver = false;
    this.pendingPromotion = null;
    this.moveLog = [];

    this.buildBoard();
    this.bindControls();
    this.render();
    this.updateStatus();
  }

  buildBoard() {
    this.boardEl.innerHTML = '';
    this.squares = [];
    for (let r = 0; r < 8; r++) {
      const rowEls = [];
      for (let c = 0; c < 8; c++) {
        const sq = document.createElement('div');
        sq.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
        sq.dataset.row = r;
        sq.dataset.col = c;
        sq.addEventListener('click', () => this.onSquareClick(r, c));

        // File/rank coordinate labels along the edges.
        if (c === 0) {
          const rank = document.createElement('span');
          rank.className = 'coord rank';
          rank.textContent = 8 - r;
          sq.appendChild(rank);
        }
        if (r === 7) {
          const file = document.createElement('span');
          file.className = 'coord file';
          file.textContent = 'abcdefgh'[c];
          sq.appendChild(file);
        }

        this.boardEl.appendChild(sq);
        rowEls.push(sq);
      }
      this.squares.push(rowEls);
    }
  }

  bindControls() {
    document.getElementById('new-game').addEventListener('click', () => this.newGame());
    document.getElementById('undo').addEventListener('click', () => this.undo());

    const diff = document.getElementById('difficulty');
    diff.value = this.difficulty;
    diff.addEventListener('change', (e) => { this.difficulty = e.target.value; });

    const side = document.getElementById('side');
    side.value = this.humanColor;
    side.addEventListener('change', (e) => {
      this.humanColor = e.target.value;
      this.newGame();
    });
  }

  newGame() {
    this.game.reset();
    this.selected = null;
    this.legalForSelected = [];
    this.gameOver = false;
    this.thinking = false;
    this.pendingPromotion = null;
    this.moveLog = [];
    this.closePromotion();
    this.render();
    this.updateStatus();
    // If the human is Black, the AI (White) moves first.
    if (this.humanColor === BLACK) this.scheduleAIMove();
  }

  undo() {
    if (this.thinking) return;
    // Undo a full pair of plies so it's the human's turn again.
    if (this.game.history.length === 0) return;
    this.game.undo();
    this.moveLog.pop();
    if (this.game.turn !== this.humanColor && this.game.history.length > 0) {
      this.game.undo();
      this.moveLog.pop();
    }
    this.gameOver = false;
    this.selected = null;
    this.legalForSelected = [];
    this.render();
    this.updateStatus();
  }

  onSquareClick(row, col) {
    if (this.gameOver || this.thinking || this.pendingPromotion) return;
    if (this.game.turn !== this.humanColor) return;

    const piece = this.game.get(row, col);

    // If a piece is already selected, try to move there.
    if (this.selected) {
      const move = this.legalForSelected.find(
        (m) => m.to[0] === row && m.to[1] === col
      );
      if (move) {
        this.tryMove(move);
        return;
      }
      // Clicking another own piece reselects; otherwise clears selection.
      if (piece && Chess.pieceColor(piece) === this.humanColor) {
        this.select(row, col);
      } else {
        this.clearSelection();
      }
      return;
    }

    if (piece && Chess.pieceColor(piece) === this.humanColor) {
      this.select(row, col);
    }
  }

  select(row, col) {
    this.selected = [row, col];
    this.legalForSelected = this.game.legalMovesFrom(row, col);
    this.render();
  }

  clearSelection() {
    this.selected = null;
    this.legalForSelected = [];
    this.render();
  }

  tryMove(move) {
    // Promotion needs a choice. Moves come in as separate entries per promotion
    // piece; the generator defaults are present, so prompt the user.
    if (move.promotion) {
      this.promptPromotion(move);
      return;
    }
    this.commitMove(move);
  }

  commitMove(move) {
    this.game.makeMove(move);
    this.recordMove(move);
    this.selected = null;
    this.legalForSelected = [];
    this.render();
    this.updateStatus();

    if (this.isGameOver()) return;
    this.scheduleAIMove();
  }

  scheduleAIMove() {
    if (this.gameOver) return;
    this.thinking = true;
    this.statusEl.textContent = 'AI is thinking…';
    this.statusEl.className = 'status thinking';
    // Defer so the "thinking" message paints before the (synchronous) search.
    setTimeout(() => this.runAIMove(), 30);
  }

  runAIMove() {
    const depth = DIFFICULTY_DEPTH[this.difficulty];
    const { move } = findBestMove(this.game, depth);
    this.thinking = false;
    if (!move) {
      this.updateStatus();
      return;
    }
    this.game.makeMove(move);
    this.recordMove(move);
    this.lastAIMove = move;
    this.render();
    this.updateStatus();
    this.isGameOver();
  }

  recordMove(move) {
    this.moveLog.push(this.toSAN(move));
    this.renderMoveLog();
  }

  // Minimal Standard Algebraic Notation for the move list (good enough for a
  // readable history; not a full SAN with disambiguation in every case).
  toSAN(move) {
    if (move.castle === 'K') return 'O-O';
    if (move.castle === 'Q') return 'O-O-O';
    const type = Chess.pieceType(move.piece);
    const dest = squareName(move.to[0], move.to[1]);
    const capture = move.captured || move.enPassant ? 'x' : '';
    let txt;
    if (type === 'P') {
      const fromFile = 'abcdefgh'[move.from[1]];
      txt = (capture ? fromFile + 'x' : '') + dest;
      if (move.promotion) txt += '=' + move.promotion;
    } else {
      txt = type + capture + dest;
    }
    return txt;
  }

  renderMoveLog() {
    this.movesEl.innerHTML = '';
    for (let i = 0; i < this.moveLog.length; i += 2) {
      const li = document.createElement('div');
      li.className = 'move-pair';
      const num = i / 2 + 1;
      const white = this.moveLog[i] || '';
      const black = this.moveLog[i + 1] || '';
      li.innerHTML =
        `<span class="move-num">${num}.</span>` +
        `<span class="move-w">${white}</span>` +
        `<span class="move-b">${black}</span>`;
      this.movesEl.appendChild(li);
    }
    this.movesEl.scrollTop = this.movesEl.scrollHeight;
  }

  isGameOver() {
    const status = this.game.status();
    if (status === 'checkmate' || status === 'stalemate' ||
        status === 'insufficient' || status === 'fiftymove') {
      this.gameOver = true;
      this.updateStatus();
      return true;
    }
    return false;
  }

  updateStatus() {
    const status = this.game.status();
    const sideToMove = this.game.turn === WHITE ? 'White' : 'Black';
    let text;
    let cls = 'status';

    if (status === 'checkmate') {
      const winner = this.game.turn === WHITE ? 'Black' : 'White';
      text = `Checkmate — ${winner} wins!`;
      cls += ' over';
    } else if (status === 'stalemate') {
      text = 'Stalemate — draw.';
      cls += ' over';
    } else if (status === 'insufficient') {
      text = 'Draw — insufficient material.';
      cls += ' over';
    } else if (status === 'fiftymove') {
      text = 'Draw — fifty-move rule.';
      cls += ' over';
    } else if (status === 'check') {
      text = `${sideToMove} to move — check!`;
      cls += ' check';
    } else {
      text = `${sideToMove} to move.`;
    }
    this.statusEl.textContent = text;
    this.statusEl.className = cls;
    this.renderCaptured();
  }

  renderCaptured() {
    // Count missing material to show captured pieces.
    const counts = {};
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.game.board[r][c];
        if (p) counts[p] = (counts[p] || 0) + 1;
      }
    }
    const initial = { P: 8, N: 2, B: 2, R: 2, Q: 1 };
    const buildList = (color) => {
      let html = '';
      for (const type of ['Q', 'R', 'B', 'N', 'P']) {
        const present = counts[color + type] || 0;
        const missing = initial[type] - present;
        for (let i = 0; i < missing; i++) html += UNICODE[color + type];
      }
      return html;
    };
    // Show pieces each side has captured (i.e. opponent's missing pieces).
    this.capturedWhiteEl.textContent = buildList(BLACK); // White captured Black pieces
    this.capturedBlackEl.textContent = buildList(WHITE);
  }

  render() {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = this.squares[r][c];
        // Remove piece glyph nodes but keep coordinate labels.
        const existing = sq.querySelector('.piece');
        if (existing) existing.remove();

        const piece = this.game.board[r][c];
        if (piece) {
          const span = document.createElement('span');
          span.className = 'piece ' + (Chess.pieceColor(piece) === WHITE ? 'white' : 'black');
          span.textContent = UNICODE[piece];
          sq.appendChild(span);
        }

        sq.classList.remove('selected', 'legal', 'legal-capture', 'last-move', 'in-check');
      }
    }

    // Highlight selection and legal targets.
    if (this.selected) {
      const [sr, sc] = this.selected;
      this.squares[sr][sc].classList.add('selected');
      for (const m of this.legalForSelected) {
        const [tr, tc] = m.to;
        const targetHasPiece = this.game.board[tr][tc] || m.enPassant;
        this.squares[tr][tc].classList.add(targetHasPiece ? 'legal-capture' : 'legal');
      }
    }

    // Highlight last move.
    const last = this.game.history[this.game.history.length - 1];
    if (last) {
      const [fr, fc] = last.move.from;
      const [tr, tc] = last.move.to;
      this.squares[fr][fc].classList.add('last-move');
      this.squares[tr][tc].classList.add('last-move');
    }

    // Highlight a king in check.
    for (const color of [WHITE, BLACK]) {
      if (this.game.inCheck(color)) {
        const k = this.game.findKing(color);
        if (k) this.squares[k[0]][k[1]].classList.add('in-check');
      }
    }
  }

  promptPromotion(baseMove) {
    this.pendingPromotion = baseMove;
    const overlay = document.getElementById('promotion');
    const choices = overlay.querySelector('.promotion-choices');
    choices.innerHTML = '';
    const color = this.humanColor;
    for (const type of ['Q', 'R', 'B', 'N']) {
      const btn = document.createElement('button');
      btn.className = 'promo-btn';
      btn.textContent = UNICODE[color + type];
      btn.addEventListener('click', () => {
        const move = this.legalForSelected.find(
          (m) =>
            m.to[0] === baseMove.to[0] &&
            m.to[1] === baseMove.to[1] &&
            m.promotion === type
        );
        this.closePromotion();
        this.pendingPromotion = null;
        if (move) this.commitMove(move);
      });
      choices.appendChild(btn);
    }
    overlay.classList.add('visible');
  }

  closePromotion() {
    document.getElementById('promotion').classList.remove('visible');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.gameUI = new GameUI();
});

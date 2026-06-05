/*
 * chess.js — Chess rules engine.
 *
 * Board representation:
 *   - 8x8 array `board[row][col]`.
 *   - row 0 is rank 8 (Black's back rank), row 7 is rank 1 (White's back rank).
 *   - col 0 is file 'a', col 7 is file 'h'.
 *   - Each square holds either null (empty) or a piece string: a color char
 *     ('w' | 'b') followed by a type char ('P','N','B','R','Q','K').
 *
 * The engine generates fully legal moves (king safety enforced) and supports
 * castling, en passant and pawn promotion.
 */

const WHITE = 'w';
const BLACK = 'b';

function otherColor(color) {
  return color === WHITE ? BLACK : WHITE;
}

function inBounds(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

class Chess {
  constructor() {
    this.reset();
  }

  reset() {
    // Standard starting position.
    const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    this.board = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (let c = 0; c < 8; c++) {
      this.board[0][c] = 'b' + back[c];
      this.board[1][c] = 'bP';
      this.board[6][c] = 'wP';
      this.board[7][c] = 'w' + back[c];
    }
    this.turn = WHITE;
    // Castling rights.
    this.castling = { wK: true, wQ: true, bK: true, bQ: true };
    // En passant target square [row, col] or null.
    this.enPassant = null;
    this.halfmoveClock = 0; // for fifty-move rule
    this.fullmoveNumber = 1;
    this.history = [];
  }

  static pieceColor(piece) {
    return piece ? piece[0] : null;
  }

  static pieceType(piece) {
    return piece ? piece[1] : null;
  }

  get(row, col) {
    return this.board[row][col];
  }

  // Deep-ish clone of mutable state for AI search / undo snapshots.
  snapshot() {
    return {
      board: this.board.map((r) => r.slice()),
      turn: this.turn,
      castling: { ...this.castling },
      enPassant: this.enPassant ? this.enPassant.slice() : null,
      halfmoveClock: this.halfmoveClock,
      fullmoveNumber: this.fullmoveNumber,
    };
  }

  restore(snap) {
    this.board = snap.board.map((r) => r.slice());
    this.turn = snap.turn;
    this.castling = { ...snap.castling };
    this.enPassant = snap.enPassant ? snap.enPassant.slice() : null;
    this.halfmoveClock = snap.halfmoveClock;
    this.fullmoveNumber = snap.fullmoveNumber;
  }

  findKing(color) {
    const king = color + 'K';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.board[r][c] === king) return [r, c];
      }
    }
    return null;
  }

  // Is the given square attacked by any piece of `byColor`?
  isAttacked(row, col, byColor) {
    // Pawn attacks. White pawns attack upward (toward row 0); a white pawn on
    // (r, c) attacks (r-1, c±1). So square (row,col) is attacked by a white
    // pawn sitting at (row+1, col±1).
    const pawnDir = byColor === WHITE ? 1 : -1;
    for (const dc of [-1, 1]) {
      const r = row + pawnDir;
      const c = col + dc;
      if (inBounds(r, c) && this.board[r][c] === byColor + 'P') return true;
    }

    // Knight attacks.
    const knightMoves = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1],
    ];
    for (const [dr, dc] of knightMoves) {
      const r = row + dr;
      const c = col + dc;
      if (inBounds(r, c) && this.board[r][c] === byColor + 'N') return true;
    }

    // King attacks (adjacent squares).
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = col + dc;
        if (inBounds(r, c) && this.board[r][c] === byColor + 'K') return true;
      }
    }

    // Sliding pieces: bishops/queens on diagonals, rooks/queens on lines.
    const diagonals = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    const straights = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    for (const [dr, dc] of diagonals) {
      let r = row + dr;
      let c = col + dc;
      while (inBounds(r, c)) {
        const p = this.board[r][c];
        if (p) {
          if (Chess.pieceColor(p) === byColor) {
            const t = Chess.pieceType(p);
            if (t === 'B' || t === 'Q') return true;
          }
          break;
        }
        r += dr;
        c += dc;
      }
    }

    for (const [dr, dc] of straights) {
      let r = row + dr;
      let c = col + dc;
      while (inBounds(r, c)) {
        const p = this.board[r][c];
        if (p) {
          if (Chess.pieceColor(p) === byColor) {
            const t = Chess.pieceType(p);
            if (t === 'R' || t === 'Q') return true;
          }
          break;
        }
        r += dr;
        c += dc;
      }
    }

    return false;
  }

  inCheck(color) {
    const king = this.findKing(color);
    if (!king) return false;
    return this.isAttacked(king[0], king[1], otherColor(color));
  }

  // Generate pseudo-legal moves (ignoring whether own king is left in check)
  // for the piece on (row, col).
  pseudoMovesFrom(row, col) {
    const piece = this.board[row][col];
    if (!piece) return [];
    const color = Chess.pieceColor(piece);
    const type = Chess.pieceType(piece);
    const moves = [];

    const addMove = (toRow, toCol, opts = {}) => {
      moves.push({ from: [row, col], to: [toRow, toCol], piece, ...opts });
    };

    if (type === 'P') {
      const dir = color === WHITE ? -1 : 1;
      const startRow = color === WHITE ? 6 : 1;
      const promoRow = color === WHITE ? 0 : 7;

      // Forward one.
      const oneRow = row + dir;
      if (inBounds(oneRow, col) && !this.board[oneRow][col]) {
        if (oneRow === promoRow) {
          for (const promo of ['Q', 'R', 'B', 'N']) {
            addMove(oneRow, col, { promotion: promo });
          }
        } else {
          addMove(oneRow, col);
          // Forward two from start.
          const twoRow = row + 2 * dir;
          if (row === startRow && !this.board[twoRow][col]) {
            addMove(twoRow, col, { double: true });
          }
        }
      }

      // Captures (including en passant).
      for (const dc of [-1, 1]) {
        const r = row + dir;
        const c = col + dc;
        if (!inBounds(r, c)) continue;
        const target = this.board[r][c];
        if (target && Chess.pieceColor(target) !== color) {
          if (r === promoRow) {
            for (const promo of ['Q', 'R', 'B', 'N']) {
              addMove(r, c, { capture: true, promotion: promo });
            }
          } else {
            addMove(r, c, { capture: true });
          }
        } else if (
          this.enPassant &&
          this.enPassant[0] === r &&
          this.enPassant[1] === c
        ) {
          addMove(r, c, { capture: true, enPassant: true });
        }
      }
    } else if (type === 'N') {
      const knightMoves = [
        [-2, -1], [-2, 1], [-1, -2], [-1, 2],
        [1, -2], [1, 2], [2, -1], [2, 1],
      ];
      for (const [dr, dc] of knightMoves) {
        const r = row + dr;
        const c = col + dc;
        if (!inBounds(r, c)) continue;
        const target = this.board[r][c];
        if (!target) addMove(r, c);
        else if (Chess.pieceColor(target) !== color) addMove(r, c, { capture: true });
      }
    } else if (type === 'K') {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r = row + dr;
          const c = col + dc;
          if (!inBounds(r, c)) continue;
          const target = this.board[r][c];
          if (!target) addMove(r, c);
          else if (Chess.pieceColor(target) !== color) addMove(r, c, { capture: true });
        }
      }
      // Castling.
      this.addCastlingMoves(row, col, color, addMove);
    } else {
      // Sliding pieces: bishop, rook, queen.
      let dirs;
      if (type === 'B') dirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      else if (type === 'R') dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      else dirs = [
        [-1, -1], [-1, 1], [1, -1], [1, 1],
        [-1, 0], [1, 0], [0, -1], [0, 1],
      ];

      for (const [dr, dc] of dirs) {
        let r = row + dr;
        let c = col + dc;
        while (inBounds(r, c)) {
          const target = this.board[r][c];
          if (!target) {
            addMove(r, c);
          } else {
            if (Chess.pieceColor(target) !== color) addMove(r, c, { capture: true });
            break;
          }
          r += dr;
          c += dc;
        }
      }
    }

    return moves;
  }

  addCastlingMoves(row, col, color, addMove) {
    if (this.inCheck(color)) return;
    const enemy = otherColor(color);
    const homeRow = color === WHITE ? 7 : 0;
    if (row !== homeRow || col !== 4) return; // king must be on its origin square

    const kingSide = color === WHITE ? this.castling.wK : this.castling.bK;
    const queenSide = color === WHITE ? this.castling.wQ : this.castling.bQ;

    // King-side: squares f and g must be empty and not attacked.
    if (kingSide && !this.board[homeRow][5] && !this.board[homeRow][6]) {
      if (
        this.board[homeRow][7] === color + 'R' &&
        !this.isAttacked(homeRow, 5, enemy) &&
        !this.isAttacked(homeRow, 6, enemy)
      ) {
        addMove(homeRow, 6, { castle: 'K' });
      }
    }
    // Queen-side: squares b, c, d empty; c and d not attacked.
    if (queenSide && !this.board[homeRow][1] && !this.board[homeRow][2] && !this.board[homeRow][3]) {
      if (
        this.board[homeRow][0] === color + 'R' &&
        !this.isAttacked(homeRow, 2, enemy) &&
        !this.isAttacked(homeRow, 3, enemy)
      ) {
        addMove(homeRow, 2, { castle: 'Q' });
      }
    }
  }

  // All legal moves for `color` (defaults to side to move).
  legalMoves(color = this.turn) {
    const moves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = this.board[r][c];
        if (!piece || Chess.pieceColor(piece) !== color) continue;
        for (const move of this.pseudoMovesFrom(r, c)) {
          const snap = this.snapshot();
          this.applyMove(move);
          if (!this.inCheck(color)) moves.push(move);
          this.restore(snap);
        }
      }
    }
    return moves;
  }

  legalMovesFrom(row, col) {
    const piece = this.board[row][col];
    if (!piece || Chess.pieceColor(piece) !== this.turn) return [];
    const color = Chess.pieceColor(piece);
    const legal = [];
    for (const move of this.pseudoMovesFrom(row, col)) {
      const snap = this.snapshot();
      this.applyMove(move);
      if (!this.inCheck(color)) legal.push(move);
      this.restore(snap);
    }
    return legal;
  }

  // Apply a move to the board. Does not validate legality; assumes the move was
  // produced by the generator. Updates castling rights, en passant and clocks.
  applyMove(move) {
    const [fr, fc] = move.from;
    const [tr, tc] = move.to;
    const piece = this.board[fr][fc];
    const color = Chess.pieceColor(piece);
    const type = Chess.pieceType(piece);

    const captured = move.enPassant
      ? this.board[fr][tc]
      : this.board[tr][tc];

    // Move the piece.
    this.board[tr][tc] = piece;
    this.board[fr][fc] = null;

    // En passant: remove the captured pawn that sits beside, not on, the target.
    if (move.enPassant) {
      this.board[fr][tc] = null;
    }

    // Promotion.
    if (move.promotion) {
      this.board[tr][tc] = color + move.promotion;
    }

    // Castling: move the rook too.
    if (move.castle === 'K') {
      this.board[tr][5] = this.board[tr][7];
      this.board[tr][7] = null;
    } else if (move.castle === 'Q') {
      this.board[tr][3] = this.board[tr][0];
      this.board[tr][0] = null;
    }

    // Update castling rights.
    if (type === 'K') {
      if (color === WHITE) { this.castling.wK = false; this.castling.wQ = false; }
      else { this.castling.bK = false; this.castling.bQ = false; }
    }
    // Rook moved or was captured from a corner.
    const touchCorner = (r, c) => {
      if (r === 7 && c === 0) this.castling.wQ = false;
      else if (r === 7 && c === 7) this.castling.wK = false;
      else if (r === 0 && c === 0) this.castling.bQ = false;
      else if (r === 0 && c === 7) this.castling.bK = false;
    };
    touchCorner(fr, fc);
    touchCorner(tr, tc);

    // Update en passant target.
    if (move.double) {
      this.enPassant = [(fr + tr) / 2, fc];
    } else {
      this.enPassant = null;
    }

    // Clocks.
    if (type === 'P' || captured) this.halfmoveClock = 0;
    else this.halfmoveClock++;
    if (color === BLACK) this.fullmoveNumber++;

    this.turn = otherColor(color);
    move.captured = captured; // annotate for undo / display
    return captured;
  }

  // Apply a move and record history so it can be undone.
  makeMove(move) {
    const snap = this.snapshot();
    this.applyMove(move);
    this.history.push({ move, snap });
  }

  undo() {
    const last = this.history.pop();
    if (!last) return null;
    this.restore(last.snap);
    return last.move;
  }

  isCheckmate(color = this.turn) {
    return this.inCheck(color) && this.legalMoves(color).length === 0;
  }

  isStalemate(color = this.turn) {
    return !this.inCheck(color) && this.legalMoves(color).length === 0;
  }

  // Insufficient material: K vs K, K+minor vs K, K+B vs K+B (same color bishops).
  isInsufficientMaterial() {
    const pieces = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && Chess.pieceType(p) !== 'K') pieces.push({ p, r, c });
      }
    }
    if (pieces.length === 0) return true;
    if (pieces.length === 1) {
      const t = Chess.pieceType(pieces[0].p);
      return t === 'N' || t === 'B';
    }
    if (pieces.length === 2) {
      const allBishops = pieces.every((x) => Chess.pieceType(x.p) === 'B');
      if (allBishops) {
        const sq0 = (pieces[0].r + pieces[0].c) % 2;
        const sq1 = (pieces[1].r + pieces[1].c) % 2;
        return sq0 === sq1; // bishops on same color squares
      }
    }
    return false;
  }

  // Returns a status string describing the game state for the side to move.
  status() {
    if (this.isCheckmate()) return 'checkmate';
    if (this.isStalemate()) return 'stalemate';
    if (this.isInsufficientMaterial()) return 'insufficient';
    if (this.halfmoveClock >= 100) return 'fiftymove';
    if (this.inCheck(this.turn)) return 'check';
    return 'normal';
  }
}

// Algebraic square name helper, e.g. [7,0] -> "a1".
function squareName(row, col) {
  return 'abcdefgh'[col] + (8 - row);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Chess, WHITE, BLACK, otherColor, squareName };
}

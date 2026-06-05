/*
 * ai.js — Minimax chess AI with alpha-beta pruning.
 *
 * The engine searches the game tree to a fixed depth, scoring leaf positions
 * with a material + piece-square-table evaluation. Alpha-beta pruning and
 * simple move ordering (captures first, MVV-LVA) keep the search tractable.
 */

// Centipawn material values.
const PIECE_VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };

// Piece-square tables from White's perspective (row 0 = rank 8). Values nudge
// pieces toward good squares: pawns advance, knights centralize, etc.
const PST = {
  P: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  N: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  B: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  R: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  Q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  // King: encourage safety (stay home / castle) in the middlegame.
  K: [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20],
  ],
};

const MATE_SCORE = 1000000;

// Evaluate the position from the perspective of `color` (positive = good for
// `color`). Combines material and piece-square placement.
function evaluate(game, color) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = game.board[r][c];
      if (!piece) continue;
      const pColor = Chess.pieceColor(piece);
      const type = Chess.pieceType(piece);
      let value = PIECE_VALUE[type];
      // Piece-square tables are written from White's perspective; mirror rows
      // for Black.
      const pstRow = pColor === WHITE ? r : 7 - r;
      value += PST[type][pstRow][c];
      score += pColor === color ? value : -value;
    }
  }
  return score;
}

// Order moves to improve alpha-beta cutoffs: captures first, ranked by
// most-valuable-victim / least-valuable-attacker, then promotions.
function orderMoves(game, moves) {
  return moves
    .map((m) => {
      let score = 0;
      const [tr, tc] = m.to;
      const victim = m.enPassant ? 'P' : Chess.pieceType(game.board[tr][tc]);
      if (victim) {
        const attacker = Chess.pieceType(m.piece);
        score += 10 * PIECE_VALUE[victim] - PIECE_VALUE[attacker];
      }
      if (m.promotion) score += PIECE_VALUE[m.promotion];
      return { m, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);
}

// Alpha-beta negamax. Returns the score for the side to move in `game`.
function alphaBeta(game, depth, alpha, beta, rootColor) {
  if (depth === 0) {
    return evaluate(game, game.turn);
  }

  const moves = game.legalMoves(game.turn);

  if (moves.length === 0) {
    // Checkmate is very bad for the side to move; stalemate is neutral.
    if (game.inCheck(game.turn)) return -MATE_SCORE - depth;
    return 0;
  }

  let best = -Infinity;
  for (const move of orderMoves(game, moves)) {
    const snap = game.snapshot();
    game.applyMove(move);
    const score = -alphaBeta(game, depth - 1, -beta, -alpha, rootColor);
    game.restore(snap);

    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // beta cutoff
  }
  return best;
}

// Pick the best move for the side to move at the given search depth. Returns
// { move, score } or { move: null } if no legal moves exist.
function findBestMove(game, depth) {
  const moves = game.legalMoves(game.turn);
  if (moves.length === 0) return { move: null, score: 0 };

  let bestMove = null;
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  // Slight randomization among equal-best moves keeps play from being identical
  // every game.
  const ordered = orderMoves(game, moves);
  for (const move of ordered) {
    const snap = game.snapshot();
    game.applyMove(move);
    const score = -alphaBeta(game, depth - 1, -beta, -alpha, game.turn);
    game.restore(snap);

    if (
      score > bestScore ||
      (score === bestScore && Math.random() < 0.3)
    ) {
      bestScore = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;
  }

  return { move: bestMove, score: bestScore };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evaluate, findBestMove, PIECE_VALUE };
}

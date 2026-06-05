# ♞ Chess vs Minimax AI

A complete browser-based chess game with an AI opponent powered by the
**minimax algorithm with alpha-beta pruning**. No build step, no dependencies —
just open `index.html` in a browser and play.

## Features

- **Full chess rules**: legal move generation with check, checkmate, stalemate,
  castling, en passant, pawn promotion, the fifty-move rule, and
  insufficient-material draws.
- **Minimax AI** with alpha-beta pruning, move ordering (MVV-LVA), and a
  material + piece-square-table evaluation function.
- **Three difficulty levels** (search depth 2 / 3 / 4).
- **Play as White or Black** against the engine.
- Click-to-move with highlighted legal targets, last-move and check
  highlighting, captured-piece tracking, an algebraic move list, undo, and a
  promotion picker.
- Responsive layout that works on desktop and mobile.

## Getting started

Open `index.html` directly in any modern browser:

```sh
# from the project root
open index.html        # macOS
xdg-open index.html    # Linux
# or just double-click the file
```

No server or install required.

## How to play

1. Choose your colour and difficulty in the side panel, then click **New Game**.
2. Click one of your pieces — its legal moves are highlighted.
3. Click a highlighted square to move. The AI replies automatically.
4. Use **Undo** to take back your last move, or **New Game** to restart.

## Project structure

```
index.html      Page layout and script includes
styles.css      Board, pieces, and panel styling
js/chess.js     Chess rules engine (board state, move generation, game status)
js/ai.js        Minimax + alpha-beta AI and position evaluation
js/ui.js        DOM rendering, input handling, and game flow
```

## How the AI works

The engine searches the game tree to a fixed depth using
[minimax](https://en.wikipedia.org/wiki/Minimax) in its negamax form, pruning
branches that cannot affect the result with
[alpha-beta pruning](https://en.wikipedia.org/wiki/Alpha%E2%80%93beta_pruning).
Leaf positions are scored by combining:

- **Material** — standard centipawn values (pawn 100 … queen 900).
- **Piece-square tables** — positional bonuses that nudge pieces toward good
  squares (advanced pawns, centralized knights, a safely castled king, etc.).

Captures and promotions are searched first (most-valuable-victim /
least-valuable-attacker ordering) so alpha-beta prunes more aggressively, and a
small amount of randomness among equally-good moves keeps games varied.

Increasing the difficulty raises the search depth, which makes the AI stronger
but slower to move.

## Engine correctness

The move generator passes [perft](https://www.chessprogramming.org/Perft) node
counts from the starting position through depth 4 (20 → 400 → 8,902 → 197,281),
which exercises castling, en passant, promotion, and check legality.

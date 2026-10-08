# Simple Chess Video Analyzer Extension

Reads the chessboard in a video (YouTube, Twitch, any page with a `<video>`)
5 times a second and shows Stockfish's top 3 lines next to it, with arrows
drawn over the board. Everything runs locally in your browser.

## Install (about 2 minutes)

1. Unzip this folder somewhere permanent (Chrome loads it from there).
2. Open `chrome://extensions` and switch on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped extension folder.
4. Pin the extension from the puzzle-piece menu so the ♞ button is visible.

## Use

1. Open a chess video and click the ♞ button (or press **Alt+Shift+A**).
2. Drag a square around the board, covering just the 64 squares. It doesn't
   need to be exact; the box snaps to the grid.
3. Analysis starts at the first move that gets highlighted on the board.

Panel controls: **Bottom** sets the board orientation (auto-detected by
default). **Arrows** toggles the move arrows over the video. **Reselect board**
redraws the box. **Copy FEN** and **Lichess ↗** export the current position.
Under **Detected board** you can see what the scanner read and what it did with
the last scan.

## How it works

- **Scanner** (`recognizer.js`, `model/model.onnx`): a small CNN classifies
  each of the 64 squares. It is trained on synthetic boards from 37 piece sets,
  with arrows, circles, square highlights, move dots, cursors, coordinates and
  video compression, so these annotations don't confuse it. Only squares whose
  pixels changed are re-classified. It runs on onnxruntime-web (WASM).
- **Last-move detector** (`highlights.js`): finds the unique pair of squares
  tinted by the same translucent overlay (lichess green-yellow, chess.com yellow,
  and others). Single marks such as a selected square, check glow or red
  right-click squares are ignored. Three same-colour squares (chess.com while
  dragging) count as no pair.
- **Belief history** (`position.js`):
  - A scan is used only once two consecutive raw scans agree, which skips frames
    where a piece is still sliding. A scan is discarded if it has no last-move
    pair, or the same pair as the last accepted scan; this ignores hovering and
    dragged pieces.
  - Each accepted scan produces a *default* belief (that position with no
    history), plus one *continuation* belief for every earlier belief from which
    the highlighted move legally leads to the scanned position.
  - Up to 100 beliefs are kept. The engine analyses the newest scan's belief
    with the longest history, given as `position fen <root> moves …`, so it
    knows side to move, castling rights, en passant, the 50-move clock and
    repetitions.
- **Engine**: Stockfish 19 lite (single-threaded WASM) with MultiPV 3.

## Limitations

- Boards with no last-move highlighting (some broadcasts, book diagrams) are
  never analysed, because every scan is discarded.
- The starting position is only picked up once the first move is highlighted.
- The highlight detector is most reliable on flat-colour themes at normal video
  sizes. Wood/marble textured boards and very small boards (under ~25 px per
  square) miss more often. A miss only delays things; it doesn't produce a
  wrong position.
- If the video can't be read directly (DRM-protected players), it falls back to
  screen capture at about 2 scans per second.

## Licenses

Stockfish.js: GPLv3 (`engine/COPYING-stockfish.txt`). chess.js: BSD-2
(`lib/LICENSE-chess.js.txt`). onnxruntime-web: MIT. Piece sets used for training
come from lichess (various open licenses).

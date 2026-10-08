# Simple Chess Video Analyzer Extension

**Simple Chess Video Analyzer Extension** is a Chrome extension that watches the chessboard in a video (YouTube, Twitch, any page with a `<video>`) and shows Stockfish's top 3 lines next to it, with arrows on the board and chess.com-style move labels. It runs entirely in your browser: no account, no server, nothing is uploaded.

It won't run on chess.com, lichess.org or other sites where people play live games.

## Install

From source (until it's on the Chrome Web Store):

1. Download or clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension/` folder.
4. Pin the extension so the ♞ button is visible.

## Use

1. Open a chess video and click ♞ (or press **Alt+Shift+A**).
2. Drag a square around the board, covering just the 64 squares. It snaps to the grid, so it doesn't need to be exact.
3. Analysis starts at the first move that is highlighted on the board.

The panel shows:

- the evaluation and Stockfish's three best lines
- whose move it is, and how many moves of history it has worked out
- a label for the last move

The controls let you:

- set which side is at the bottom (auto by default)
- toggle the arrows and the move labels
- pause scanning or reselect the board
- copy the FEN, or open the position on Lichess

**Detected board** holds the max scan rate, the scan stats, what the scanner read, and what it did with the last scan.

## How it works

**Scanning.** Every new video frame is scanned once, via `requestVideoFrameCallback`, up to a configurable maximum rate. A paused video costs nothing.

**Square classifier.** A small CNN (`extension/model/model.onnx`, 1.2 MB) classifies each of the 64 squares as empty or one of the 12 pieces. It runs on onnxruntime-web (WASM). Only squares whose pixels changed are re-classified.
- It's trained only on synthetic boards from 39 lichess piece sets and 25 board themes, plus random colours.
- The training boards are cluttered on purpose with arrows, circles, square highlights, move dots, coordinates, cursors, blur and video compression, so annotations don't fool it.

**Last-move detector** (`highlights.js`). It finds the unique pair of squares tinted by the same translucent overlay: lichess green-yellow, chess.com yellow, and others. Selected squares, check glows and red marks are ignored.

**Belief tracker** (`position.js`). It turns scans into full game states: side to move, castling, en passant, and the move history, which matters for repetitions and the 50-move rule.
- **When a scan is thrown out:**
  - it has no last-move highlight
  - its highlight is the same as the previous one
  - the last move's squares are still highlighted, so the extra square is a hover
  - it isn't a legal position reached by a legal highlighted move
- **When a scan is kept,** it becomes:
  - a no-history belief
  - one continuation of every stored belief from which the highlighted move legally leads to the scanned board, with the whole board having to agree
- **Fast path and gaps.** A legal continuation is accepted on the first frame. A single missed position in between is filled in.
- **Choosing the best belief.** Up to 100 beliefs are kept. The newest scan's belief with the longest history goes to the engine as `position fen <root> moves …`.

**Engine.** Stockfish 19 lite, single-threaded WASM, with MultiPV 3. The same instance and hash table are reused across positions. When the move played was one of the engine's lines, its evaluation is shown instantly while the new search catches up.

**Move labels** (`annotate.js`). Labels come from the loss in win probability compared with the engine's best move: Brilliant, Great, Best, Excellent, Good, Inaccuracy, Mistake, Miss, Blunder.

## Repository layout

```
extension/   the Chrome extension (load this folder unpacked)
training/    synthetic data generator and classifier training (PyTorch -> ONNX)
tests/       unit tests (node) and end-to-end browser tests (Playwright)
```

### Retraining the classifier

```bash
pip install torch numpy pillow cairosvg onnx onnxruntime
# piece sets and board textures from lichess (AGPL/various licenses, not redistributed here)
git clone --depth 1 --filter=blob:none --sparse https://github.com/lichess-org/lila && (cd lila && git sparse-checkout set public/piece public/images/board)
python training/render_pieces.py lila/public/piece          # -> training/pieces/
mkdir training/boards && cp lila/public/images/board/*.{jpg,png} training/boards/   # skip *.thumbnail.* files
cd training
python gen.py preview                                     # look at preview.png
python gen.py full 3500 11 data/full_1.npz && python gen.py full 3500 12 data/full_2.npz
python train.py data/full_1.npz,data/full_2.npz - 4 final  # writes final.pt and final.onnx
python finetune.py 2                                       # optional, writes final_ft.onnx
python eval_onnx.py ../extension/model/model.onnx,final_ft.onnx staunty,cburnett,merida 80
```

### Tests

```bash
# unit tests (belief tracker, legality, hover handling, move labels)
cd tests/unit && for t in *.mjs; do node $t; done

# end-to-end: render a test game as video frames, then drive the extension in Chromium
pip install playwright python-chess && playwright install chromium
python tests/make_frames2.py tests/site/game3 staunty lichess white 3
python tests/make_frames2.py tests/site/game4 maestro chesscom black 4
python tests/run_e2e2.py game3 && python tests/run_e2e2.py game4
python tests/latency_test.py extension
```

## Limitations

- Boards without last-move highlighting (some broadcasts, book diagrams) never start analysis.
- The highlight detector is weaker on textured (wood/marble) boards and very small boards.
- Move labels need the previous position analysed to at least depth 10, so very fast sequences may go unlabelled. "Book" moves aren't detected.

## Credits and licenses

This project is licensed under the **GNU GPL v3** (see `LICENSE`), because it ships Stockfish.

- [Stockfish](https://stockfishchess.org) via [Stockfish.js](https://github.com/nmrugg/stockfish.js): GPL-3.0
- [chess.js](https://github.com/jhlywa/chess.js): BSD-2-Clause
- [onnxruntime-web](https://github.com/microsoft/onnxruntime): MIT
- The classifier was trained on renders of the [lichess](https://github.com/lichess-org/lila) piece sets and board themes. Those images are not included in this repo.

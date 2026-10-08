# Privacy Policy: Simple Chess Video Analyzer Extension

_Last updated: October 8, 2026_

Simple Chess Video Analyzer Extension does not collect, store, sell or share any personal data.

## What the extension accesses

When you click the extension's toolbar button on a page, it reads pixels from the region of the video you select (the chessboard). That's the only page content it uses, and only so it can recognize the chess position.

## What happens to it

- The board image is processed **entirely on your device**. The board recognizer and the Stockfish engine both run inside your browser.
- The image and the positions recognized from it are kept only in memory while the analysis panel is open. They are never saved, logged or transmitted.
- The extension makes **no network requests**. It has no servers, no analytics and no tracking, and it doesn't use cookies.

## Settings

A few settings, such as the maximum scan rate and whether move labels are shown, are saved in your browser's local storage so they persist between sessions. They never leave your device.

## Optional links

The "Lichess ↗" button opens the current position on lichess.org in a new tab, and only when you click it. Lichess's own privacy policy applies to that site.

## Permissions

- **activeTab**: lets the extension access the tab you're on, only after you click its toolbar button.
- **scripting**: lets it add the analysis panel and board overlay to that tab.

## Contact

Questions or concerns: open an issue at https://github.com/kawgit/Simple-Chess-Video-Analyzer-Extension/issues

// Anti-cheating guard: the extension refuses to run on sites where people play
// live games (checked on the toolbar click and again on every scan).
(function (root) {
  'use strict';
  const BLOCKED_DOMAINS = [
    'chess.com', 'lichess.org', 'lichess.dev', 'chess24.com', 'chesskid.com', 'chessclub.com',
    'playok.com', 'chessbase.com', 'worldchess.com', 'chesstempo.com', 'chess.org', 'chessfriends.com',
    'gameknot.com', 'chessable.com', 'immortal.game', 'chessarena.com', 'freechess.org', 'chess.net',
    'redhotpawn.com', 'sparkchess.com', 'chessanytime.com', 'lichess.ovh', 'listudy.org', 'chesshotel.com',
    'chessmatec.com', 'chess-online.com', 'schach.de', 'chessmood.com', 'chess.ru', 'lechecs.com',
  ];

  function isBlockedHost(host) {
    host = String(host || '').toLowerCase().replace(/\.$/, '');
    return BLOCKED_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  }

  function isBlockedUrl(url) {
    try { return isBlockedHost(new URL(url).hostname); } catch { return false; }
  }

  root.ChessGuard = { BLOCKED_DOMAINS, isBlockedHost, isBlockedUrl };
  if (typeof module !== 'undefined') module.exports = root.ChessGuard;
})(typeof self !== 'undefined' ? self : globalThis);

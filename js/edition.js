// The edition: the free browser demo (on GitHub Pages) or the full game (the itch.io builds, desktop, local copies).
// The demo is gated by content, not by a clock: a few boats and venues, free sail and AI races; the rest shows a lock
// and a link to the full game. ?demo=1 shows the demo anywhere (to try it).
export const ITCH = 'https://hclivess.itch.io/true-wind';
export const DEMO = (() => {
  try {
    if (new URLSearchParams(location.search).get('demo') === '1') return true;
    return /\.github\.io$/i.test(location.hostname);
  } catch (e) { return false; }
})();
export const DEMO_BOATS = ['blackwatch', 'j24', 'dinghy'];
export const DEMO_VENUES = ['progreso', 'solent', 'garda'];
export const boatOpen = (id) => !DEMO || DEMO_BOATS.includes(id);
export const venueOpen = (id) => !DEMO || DEMO_VENUES.includes(id);
export const modeOpen = (m) => !DEMO || m !== 'online';
// the polite nudge: once, after this much sailing in a session, a banner the player can close
export const NUDGE_MIN = 30;
export const fullLink = (text = 'Get the full game') => `<a class="itch-link" href="${ITCH}" target="_blank" rel="noopener">${text}</a>`;

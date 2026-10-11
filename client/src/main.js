// Entry point: self-hosted fonts (so the installed PWA works offline), styles, the game, and the service worker.
import '@fontsource/bowlby-one/400';
import '@fontsource/nunito/400';
import '@fontsource/nunito/700';
import '@fontsource/nunito/800';
import '@fontsource/nunito/900';
import '@fontsource/caveat/600';
import './style.css';
import './ui.js';

// not in the itch.io build: itch runs the game in a frame from its own servers, where a service worker cannot help
if ('serviceWorker' in navigator && import.meta.env.PROD && import.meta.env.MODE !== 'itch') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

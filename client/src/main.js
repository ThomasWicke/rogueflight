// Entry point: self-hosted fonts (so the installed PWA works offline), styles, the game, and the service worker.
import '@fontsource/bowlby-one/400';
import '@fontsource/nunito/400';
import '@fontsource/nunito/700';
import '@fontsource/nunito/800';
import '@fontsource/nunito/900';
import '@fontsource/caveat/600';
import './style.css';
import './ui.js';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

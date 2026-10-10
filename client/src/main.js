// Entry point: self-hosted fonts (so the installed PWA works offline), styles, the game, and the service worker.
import '@fontsource/big-shoulders-stencil-display/700';
import '@fontsource/big-shoulders-stencil-display/800';
import '@fontsource/barlow/400';
import '@fontsource/barlow/600';
import '@fontsource/barlow/700';
import '@fontsource/chakra-petch/500';
import '@fontsource/chakra-petch/600';
import './style.css';
import './ui.js';

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

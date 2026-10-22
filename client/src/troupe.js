// The troupe's painted art (generated, see docs/concept/v011): host portraits with three expressions, the home card
// pictures and the season's tour map with each town's spot on it. Only URLs and small HTML strings; ui.js places them.

// hosts: one sprite per character, three equal frames side by side (calm, delighted, worried), ar = frame width / height
const HOSTS = {
  ringmaster: { src: new URL('./assets/host-ringmaster.webp', import.meta.url).href, ar: 153 / 240 }, // basset, contracts won and lost
  announcer: { src: new URL('./assets/host-announcer.webp', import.meta.url).href, ar: 165 / 240 },   // owl, flight results
};
const MOOD = { calm: 0, happy: 1, worried: 2 };
const hostStyle = (who, mood) => `--hs:url(${HOSTS[who].src});--ar:${HOSTS[who].ar};--f:${MOOD[mood] || 0}`;
// a portrait as an inline element; cls sets its size and placement (style.css .host)
const hostHTML = (who, mood, cls = '') => `<i class="host ${cls}" data-host="${who}" style="${hostStyle(who, mood)}" aria-hidden="true"></i>`;
// change who is shown or their expression in place (no re-render)
function setHost(el, who, mood) { if (el) el.setAttribute('style', hostStyle(who, mood)), el.dataset.host = who; }

const CARD = {
  run: new URL('./assets/card-run.webp', import.meta.url).href,
  daily: new URL('./assets/card-daily.webp', import.meta.url).href,
  rooms: new URL('./assets/card-rooms.webp', import.meta.url).href,
};

// the tour map (portrait, 2:3) and each town's spot on it in percent, contract 1 at the bottom to the night fair on top
const MAP = new URL('./assets/tour-map.webp', import.meta.url).href;
const MAP_TOWNS = [[47.5, 91], [49.5, 72], [60.5, 61], [41.5, 51.5], [54, 38], [45, 26.5], [75, 18.5], [45.5, 9.4]];
// (version 1 of the map, docs/concept/v011/map-v1.jpg, would need [[52, 90], [55, 71], [62, 59], [57, 47], [73, 40], [52, 28], [50, 18], [55, 10]])
let mapImg = null;
// fetch the map ahead of the first contract clear, so it is there when the plane moves on
function preloadMap() { if (!mapImg) { mapImg = new Image(); mapImg.src = MAP; } }

// the barn workshop behind the hangar is a CSS background (style.css, url() bundled by Vite)

export { HOSTS, hostHTML, setHost, CARD, MAP, MAP_TOWNS, preloadMap };

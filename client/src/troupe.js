// The troupe's painted art (generated, see docs/concept/v011): the home card pictures and the season's tour map with
// each town's spot on it. Only URLs; ui.js places them.

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

export { CARD, MAP, MAP_TOWNS, preloadMap };

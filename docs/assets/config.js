// Address of your Cloudflare Worker. After `npm run deploy` in the worker folder,
// paste the URL it prints here (no trailing slash).
window.WINEDOG_API = 'https://winedog-api.sillymonkeyflip.workers.dev';

// When testing on your own computer, use the local worker automatically.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window.WINEDOG_API = 'http://localhost:8787';
}

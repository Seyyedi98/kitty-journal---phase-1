window.__shared = [];
window.__shareAvailable = true;
export async function isAvailableAsync() { return window.__shareAvailable; }
export async function shareAsync(uri, options) { window.__shared.push({ uri, options }); }

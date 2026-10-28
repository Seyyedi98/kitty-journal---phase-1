export const Accuracy = { Balanced: 3 };
window.__location = { granted: true, coords: { latitude: 41.0082, longitude: 28.9784 }, place: { name: 'Galata Tower', street: 'Galata', city: 'Istanbul', region: 'Istanbul', country: 'Türkiye' }, fail: false };
export async function getForegroundPermissionsAsync() { return { granted: window.__location.granted }; }
export async function requestForegroundPermissionsAsync() { return { granted: window.__location.granted }; }
export async function getCurrentPositionAsync() {
  if (window.__location.fail) throw new Error('no fix');
  return { coords: window.__location.coords };
}
export async function reverseGeocodeAsync() { return [window.__location.place]; }

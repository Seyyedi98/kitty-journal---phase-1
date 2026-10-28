// One-shot, foreground-only location lookup. It runs ONLY when the user taps
// "use current location" in the editor. There is no background tracking.
import * as Location from 'expo-location';

/**
 * @returns {Promise<{ok:true, latitude:number, longitude:number, name:string, address:string}
 *                  |{ok:false, reason:'denied'|'unavailable'}>}
 */
export async function getCurrentPlace() {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'denied' };
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const { latitude, longitude } = pos.coords;
    let name = '';
    let address = '';
    try {
      // Reverse geocoding needs the network; the coordinates are kept without it.
      const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (place) {
        name = place.name || place.street || place.district || '';
        address = [place.street, place.city || place.subregion, place.region, place.country]
          .filter(Boolean)
          .join(', ');
      }
    } catch {
      /* offline: coordinates only */
    }
    return { ok: true, latitude, longitude, name, address };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

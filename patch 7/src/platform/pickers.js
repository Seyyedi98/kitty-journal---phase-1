// Photo picker. The Android system photo picker lets the user choose specific
// images WITHOUT granting any broad media-library permission.
import * as ImagePicker from 'expo-image-picker';

/** @returns {Promise<Array>} picked assets ([] when cancelled) */
export async function pickPhotos({ limit = 10 } = {}) {
  const mediaTypes = ['images'];
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes,
    allowsMultipleSelection: true,
    selectionLimit: limit,
    quality: 1, // never let the picker re-compress; our pipeline decides
    exif: true,
  });
  if (result.canceled) return [];
  return result.assets || [];
}

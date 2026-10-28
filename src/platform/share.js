// Sharing a backup file out of the app (system share sheet).
import * as Sharing from 'expo-sharing';

/** Opens the system share sheet for a file inside the app's private storage. */
export async function shareFile(uri, { mimeType = 'application/octet-stream', dialogTitle } = {}) {
  if (!(await Sharing.isAvailableAsync())) return { shared: false, reason: 'unavailable' };
  await Sharing.shareAsync(uri, { mimeType, dialogTitle });
  return { shared: true };
}

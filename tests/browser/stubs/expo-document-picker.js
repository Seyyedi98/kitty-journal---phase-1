// Stub for expo-document-picker used in browser E2E tests.
// Tests control the next pick via window.__nextPickResult.
// Set to null to simulate cancellation, or to an asset object.
window.__nextPickResult = null; // default: cancelled

export async function getDocumentAsync(_opts) {
  const asset = window.__nextPickResult;
  window.__nextPickResult = null; // consume
  if (!asset) return { canceled: true, assets: [] };
  return { canceled: false, assets: [asset] };
}

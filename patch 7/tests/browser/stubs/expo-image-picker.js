// The test sets window.__nextPick = [{ uri, width, height }] before tapping "add photos".
export const MediaTypeOptions = { Images: 'Images' };
export async function launchImageLibraryAsync() {
  const assets = window.__nextPick || [];
  window.__nextPick = [];
  window.__pickerCalls = (window.__pickerCalls || 0) + 1;
  return { canceled: assets.length === 0, assets };
}

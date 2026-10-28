// manipulateAsync-only stub (exercises the adapter's fallback path).
export const SaveFormat = { JPEG: 'jpeg', PNG: 'png' };
let n = 0;
export async function manipulateAsync(uri, actions, opts) {
  const files = window.__files;
  const src = files.get(uri);
  if (src == null) throw new Error('manipulate: missing ' + uri);
  n += 1;
  const out = `file:///cache/manip-${n}.jpg`;
  files.set(out, src.slice(0, Math.max(400, Math.floor(src.length / 2))));
  const resize = actions && actions[0] && actions[0].resize;
  const width = (resize && resize.width) || 1000;
  const height = (resize && resize.height) || Math.round(width * 0.75);
  return { uri: out, width, height };
}

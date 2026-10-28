// Image resize/re-encode adapter over expo-image-manipulator. Supports both
// the new contextual API (SDK 52+) and the older manipulateAsync().
import * as IM from 'expo-image-manipulator';

/**
 * @param {string} uri
 * @param {{resize?: {width?:number,height?:number}|null, quality?: number}} opts
 * @returns {Promise<{uri:string,width:number,height:number}>} JPEG output
 */
export async function manipulate(uri, { resize = null, quality = 0.82 } = {}) {
  if (typeof IM.ImageManipulator?.manipulate === 'function') {
    const ctx = IM.ImageManipulator.manipulate(uri);
    try {
      if (resize) ctx.resize(resize);
      const ref = await ctx.renderAsync();
      try {
        const out = await ref.saveAsync({ compress: quality, format: IM.SaveFormat.JPEG });
        return { uri: out.uri, width: out.width, height: out.height };
      } finally {
        ref.release?.();
      }
    } finally {
      ctx.release?.();
    }
  }
  const actions = resize ? [{ resize }] : [];
  const out = await IM.manipulateAsync(uri, actions, { compress: quality, format: IM.SaveFormat.JPEG });
  return { uri: out.uri, width: out.width, height: out.height };
}

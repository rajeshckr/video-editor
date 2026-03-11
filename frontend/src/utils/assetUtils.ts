import type { Clip, AssetMeta } from '../types';

/** Resolve the asset associated with a clip (returns undefined for text/caption clips). */
export function getAssetForClip(clip: Clip, assets: AssetMeta[]): AssetMeta | undefined {
  return clip.assetId ? assets.find(a => a.id === clip.assetId) : undefined;
}

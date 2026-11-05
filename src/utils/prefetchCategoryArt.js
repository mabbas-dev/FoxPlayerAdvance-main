import { getAllCategoryArtUris } from '../constants/categoryArt';

let prefetched = false;

export function prefetchCategoryArt() {
  if (prefetched) return;
  prefetched = true;
  let Image = null;
  try {
    const mod = require('expo-image');
    Image = mod?.Image || mod?.default;
  } catch (_e) {
    return;
  }
  if (!Image?.prefetch) return;
  getAllCategoryArtUris().forEach((uri) => {
    Image.prefetch(uri).catch(() => {});
  });
}

export const CATEGORY_ART = {
  live: 'https://images.unsplash.com/photo-1478720568477-152d9b164e26?auto=format&fit=crop&w=960&q=85',
  channel: 'https://images.unsplash.com/photo-1478720568477-152d9b164e26?auto=format&fit=crop&w=960&q=85',
  movie: 'https://images.unsplash.com/photo-1489599849927-2ee91cedd3d?auto=format&fit=crop&w=960&q=85',
  series: 'https://images.unsplash.com/photo-1574375927938-d5a98e8d2190?auto=format&fit=crop&w=960&q=85',
  episode: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=960&q=85',
  favorite: 'https://images.unsplash.com/photo-1518709268805-4e9042af2178?auto=format&fit=crop&w=960&q=85',
  default: 'https://images.unsplash.com/photo-1522869635100-0f4c490e8778?auto=format&fit=crop&w=960&q=85',
};

const LOCAL_FALLBACK = require('../../assets/poster-placeholder.png');
const LOCAL_LIVE_FALLBACK = require('../../assets/channel-placeholder.png');

export function resolveCategoryArtKey(type) {
  const t = String(type || 'movie').toLowerCase();
  if (t === 'live' || t === 'channel') return 'live';
  if (t === 'series' || t === 'show') return 'series';
  if (t === 'episode') return 'episode';
  if (t === 'favorite') return 'favorite';
  if (t === 'movie' || t === 'film') return 'movie';
  return 'default';
}

export function getCategoryArtUri(type) {
  const key = resolveCategoryArtKey(type);
  return CATEGORY_ART[key] || CATEGORY_ART.default;
}

export function getLocalFallbackAsset(type) {
  const key = resolveCategoryArtKey(type);
  return key === 'live' ? LOCAL_LIVE_FALLBACK : LOCAL_FALLBACK;
}

export function getAllCategoryArtUris() {
  return [...new Set(Object.values(CATEGORY_ART))];
}

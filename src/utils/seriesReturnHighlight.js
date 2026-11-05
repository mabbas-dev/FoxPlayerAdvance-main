/** One-shot highlight when returning from player to series detail (no full reload). */
let pendingHighlight = null;

export function setSeriesReturnHighlight({ seriesId, episodeStreamId }) {
  if (!seriesId || episodeStreamId == null || episodeStreamId === '') return;
  pendingHighlight = {
    seriesId: String(seriesId),
    episodeStreamId: String(episodeStreamId),
  };
}

export function consumeSeriesReturnHighlight(seriesId) {
  if (!pendingHighlight || !seriesId) return null;
  if (pendingHighlight.seriesId !== String(seriesId)) return null;
  const episodeStreamId = pendingHighlight.episodeStreamId;
  pendingHighlight = null;
  return episodeStreamId;
}

export function peekSeriesReturnHighlight(seriesId) {
  if (!pendingHighlight || !seriesId) return null;
  if (pendingHighlight.seriesId !== String(seriesId)) return null;
  return pendingHighlight.episodeStreamId;
}

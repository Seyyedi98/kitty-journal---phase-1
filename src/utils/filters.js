// Pure filter logic (kept free of React so it can be unit-tested in Node).
export const EMPTY_FILTERS = { favorites: false, mood: null, tagId: null };

export function hasActiveFilters(f) {
  return Boolean(f.favorites || f.mood || f.tagId);
}

/** Filters combine with AND. */
export function applyFilters(entries, f) {
  if (!hasActiveFilters(f)) return entries;
  return entries.filter((e) => {
    if (f.favorites && !e.favorite) return false;
    if (f.mood && e.mood !== f.mood) return false;
    if (f.tagId && !(e.tags || []).some((x) => x.id === f.tagId)) return false;
    return true;
  });
}

// Version awareness: which build is running, and is a newer one published?
export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
export const BUILD_LABEL = typeof __BUILD_LABEL__ !== 'undefined' ? __BUILD_LABEL__ : 'dev';

/** Pure: is the published build different from the one that is running? */
export function isOutdated(running, published) {
  return !!published && published !== 'dev' && running !== 'dev' && running !== 'test' && published !== running;
}

/** Fetch version.json bypassing every cache. Resolves to the published {id,label} or null when unavailable (dev server, offline). */
export async function fetchPublished() {
  try {
    const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
    const r = await fetch(`${base}version.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j.id === 'string' ? j : null;
  } catch { return null; }
}

const STORAGE_KEY = 'dazen-usage-analytics-v1';
const DEVICE_ID_KEY = 'dazen-device-id-v1';

function createDeviceId() {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();

    const bytes = new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(bytes);
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    if (hex && !/^0+$/.test(hex)) return `device-${hex}`;
  } catch {}

  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;

    const created = createDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    // Storage-disabled/private environments cannot provide persistent
    // device identity. Keep a stable value for this document only.
    if (!globalThis.__dazenEphemeralDeviceId) {
      globalThis.__dazenEphemeralDeviceId = createDeviceId();
    }
    return globalThis.__dazenEphemeralDeviceId;
  }
}

function defaults() {
  return {
    conversions: 0,
    generations: 0,
    toolOpens: 0,
    // Legacy field retained only for backward compatibility.
    pageViews: 0,
    uniqueVisitors: 0,
    countedDeviceId: '',
    toolUsage: {},
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
  };
}

export function getUsageAnalytics() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      ...defaults(),
      ...parsed,
      toolUsage:
        parsed?.toolUsage && typeof parsed.toolUsage === 'object'
          ? parsed.toolUsage
          : {},
    };
  } catch {
    return defaults();
  }
}

function writeUsage(next) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...next,
        lastSeenAt: Date.now(),
      })
    );
  } catch {}
  return next;
}

function increment(field, amount = 1) {
  const current = getUsageAnalytics();
  const next = {
    ...current,
    [field]: Math.max(0, Number(current[field] || 0) + amount),
  };
  return writeUsage(next);
}

export function recordConversion() {
  return increment('conversions');
}

export function recordGeneration() {
  return increment('generations');
}

/**
 * Register this persistent browser/device once.
 *
 * Reloading, Ctrl+Shift+R, navigating between Dazen pages, closing/reopening
 * the browser, and restarting the computer will not increment it again as
 * long as the site's localStorage remains intact.
 *
 * True cross-device/IP deduplication requires a server-side analytics store;
 * a static GitHub Pages client cannot reliably enforce that globally.
 */
export function recordUniqueVisitor() {
  const current = getUsageAnalytics();
  const deviceId = getDeviceId();

  if (current.countedDeviceId === deviceId && Number(current.uniqueVisitors || 0) >= 1) {
    return current;
  }

  // Migrate the old reload-based pageViews counter. Because this storage is
  // scoped to one browser profile, its correct unique-device contribution is 1.
  return writeUsage({
    ...current,
    pageViews: 1,
    uniqueVisitors: 1,
    countedDeviceId: deviceId,
  });
}

// Compatibility alias for older imports. This no longer counts raw reloads.
export function recordPageView() {
  return recordUniqueVisitor();
}

export function recordToolOpen(toolKey) {
  if (!toolKey) return getUsageAnalytics();

  const current = getUsageAnalytics();
  const toolUsage = {
    ...(current.toolUsage || {}),
    [toolKey]: Number(current.toolUsage?.[toolKey] || 0) + 1,
  };

  return writeUsage({
    ...current,
    toolOpens: Number(current.toolOpens || 0) + 1,
    toolUsage,
  });
}

const STORAGE_KEY = 'dazen-usage-analytics-v1';

function defaults() {
  return {
    conversions: 0,
    generations: 0,
    toolOpens: 0,
    pageViews: 0,
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

export function recordPageView() {
  return increment('pageViews');
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

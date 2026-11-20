const ACHIEVEMENT_ASSET_CACHE_KEY = 'citywalk_achievement_asset_cache_v1';
const ACHIEVEMENT_ASSET_CACHE_TTL = 12 * 60 * 60 * 1000;

let memoryAchievementAssetCache = null;

function now() {
  return Date.now();
}

function isCloudFileId(value) {
  return typeof value === 'string' && value.indexOf('cloud://') === 0;
}

function sanitizeCacheEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const tempUrl = String(entry.tempUrl || '').trim();
  const expiresAt = Number(entry.expiresAt || 0);
  if (!tempUrl || !expiresAt || expiresAt <= now()) {
    return null;
  }

  return {
    tempUrl,
    expiresAt,
  };
}

function readAchievementAssetCache() {
  if (memoryAchievementAssetCache) {
    return memoryAchievementAssetCache;
  }

  try {
    const stored = wx.getStorageSync(ACHIEVEMENT_ASSET_CACHE_KEY);
    const normalized = {};
    Object.keys(stored || {}).forEach((key) => {
      const safeEntry = sanitizeCacheEntry(stored[key]);
      if (safeEntry) {
        normalized[key] = safeEntry;
      }
    });
    memoryAchievementAssetCache = normalized;
    return normalized;
  } catch (error) {
    memoryAchievementAssetCache = {};
    return memoryAchievementAssetCache;
  }
}

function persistAchievementAssetCache(cache) {
  memoryAchievementAssetCache = cache;
  try {
    wx.setStorageSync(ACHIEVEMENT_ASSET_CACHE_KEY, cache);
  } catch (error) {
    // Ignore storage failures and keep using the in-memory cache.
  }
}

function getCachedTempUrl(fileId) {
  const cache = readAchievementAssetCache();
  const entry = sanitizeCacheEntry(cache[fileId]);
  if (!entry) {
    if (cache[fileId]) {
      delete cache[fileId];
      persistAchievementAssetCache(cache);
    }
    return '';
  }
  return entry.tempUrl;
}

function cacheTempUrl(fileId, tempUrl) {
  if (!fileId || !tempUrl) {
    return;
  }

  const cache = {
    ...readAchievementAssetCache(),
    [fileId]: {
      tempUrl,
      expiresAt: now() + ACHIEVEMENT_ASSET_CACHE_TTL,
    },
  };
  persistAchievementAssetCache(cache);
}

async function batchResolveCloudFileIds(fileIds = []) {
  const uniqueFileIds = Array.from(new Set((fileIds || []).filter(isCloudFileId)));
  if (!uniqueFileIds.length || !wx.cloud || !wx.cloud.getTempFileURL) {
    return {};
  }

  const unresolved = [];
  const resolvedMap = {};

  uniqueFileIds.forEach((fileId) => {
    const cachedUrl = getCachedTempUrl(fileId);
    if (cachedUrl) {
      resolvedMap[fileId] = cachedUrl;
    } else {
      unresolved.push(fileId);
    }
  });

  if (!unresolved.length) {
    return resolvedMap;
  }

  const result = await wx.cloud.getTempFileURL({ fileList: unresolved });
  (result.fileList || []).forEach((item) => {
    const fileId = item.fileID || item.fileId || '';
    const tempUrl = item.tempFileURL || '';
    if (fileId && tempUrl) {
      resolvedMap[fileId] = tempUrl;
      cacheTempUrl(fileId, tempUrl);
    }
  });

  return resolvedMap;
}

async function hydrateAchievementAssets(achievements = []) {
  const list = Array.isArray(achievements) ? achievements : [];
  const assetMap = await batchResolveCloudFileIds(
    list.map((item) => item && item.asset).filter(Boolean)
  ).catch(() => ({}));

  return list.map((item) => {
    if (!item || !item.asset) {
      return item;
    }
    return {
      ...item,
      asset: assetMap[item.asset] || item.asset,
    };
  });
}

module.exports = {
  batchResolveCloudFileIds,
  hydrateAchievementAssets,
  isCloudFileId,
};

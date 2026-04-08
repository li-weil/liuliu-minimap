const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'amr', 'caf', 'flac', 'ogg', 'webm'];

function normalizeRecordedDuration(duration) {
  const numericDuration = Number(duration || 0);
  if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
    return 0;
  }
  return Math.round(numericDuration);
}

function formatAudioClock(seconds) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds || 0)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainSeconds = totalSeconds % 60;

  if (hours > 0) {
    return [
      `${hours}`.padStart(2, '0'),
      `${minutes}`.padStart(2, '0'),
      `${remainSeconds}`.padStart(2, '0'),
    ].join(':');
  }

  return [
    `${minutes}`.padStart(2, '0'),
    `${remainSeconds}`.padStart(2, '0'),
  ].join(':');
}

function inferAudioExtension(...candidates) {
  for (let index = 0; index < candidates.length; index += 1) {
    const value = String(candidates[index] || '').toLowerCase();
    const matched = value.match(/\.([a-z0-9]+)(?:$|\?)/);
    if (matched && matched[1] && AUDIO_EXTENSIONS.includes(matched[1])) {
      return matched[1];
    }
  }
  return 'mp3';
}

function hashString(input = '') {
  let hash = 2166136261;
  const text = String(input || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isHttpUrl(value = '') {
  return /^https?:\/\//i.test(String(value || ''));
}

function getFileInfo(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileInfo({
      filePath,
      success: resolve,
      fail: reject,
    });
  });
}

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (result) => {
        if (result && result.statusCode && result.statusCode >= 400) {
          reject(new Error(`download_status_${result.statusCode}`));
          return;
        }
        resolve(result);
      },
      fail: reject,
    });
  });
}

function copyFile(srcPath, destPath) {
  return new Promise((resolve, reject) => {
    const fileSystemManager = wx.getFileSystemManager();
    fileSystemManager.copyFile({
      srcPath,
      destPath,
      success: resolve,
      fail: reject,
    });
  });
}

async function ensurePlayableLocalAudio(src, options = {}) {
  if (!src || !isHttpUrl(src)) {
    return src || '';
  }

  const ext = inferAudioExtension(options.sourceHint, src);
  const cacheKey = options.cacheKey || options.sourceHint || src;
  const filePrefix = options.filePrefix || 'audio-cache';
  const targetPath = `${wx.env.USER_DATA_PATH}/${filePrefix}-${hashString(cacheKey)}.${ext}`;

  try {
    await getFileInfo(targetPath);
    return targetPath;
  } catch (error) {
    // Continue and refresh the local cache file.
  }

  const download = await downloadFile(src);
  if (!download || !download.tempFilePath) {
    return src;
  }

  try {
    await copyFile(download.tempFilePath, targetPath);
    return targetPath;
  } catch (error) {
    return download.tempFilePath || src;
  }
}

module.exports = {
  ensurePlayableLocalAudio,
  formatAudioClock,
  normalizeRecordedDuration,
};

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'heic', 'heif'];
const CANVAS_FRIENDLY_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp'];

function chooseMedia(options) {
  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      ...options,
      success: resolve,
      fail: reject,
    });
  });
}

function compressImage(src, quality = 88) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src,
      quality,
      success: resolve,
      fail: reject,
    });
  });
}

function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: resolve,
      fail: reject,
    });
  });
}

function inferExtension(filePath = '', fileType = '') {
  const normalizedType = String(fileType || '').toLowerCase().replace(/^image\//, '');
  if (normalizedType && IMAGE_EXTENSIONS.includes(normalizedType)) {
    return normalizedType;
  }
  const matched = String(filePath || '').toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/);
  return matched && matched[1] ? matched[1] : '';
}

function shouldNormalizeImage(extension = '') {
  return !CANVAS_FRIENDLY_EXTENSIONS.includes(extension);
}

async function ensureCompatibleImage(file, options = {}) {
  const input = typeof file === 'string' ? { tempFilePath: file } : (file || {});
  const tempFilePath = input.tempFilePath || input.path || input.src || '';
  if (!tempFilePath) {
    return input;
  }

  const extension = inferExtension(tempFilePath, input.fileType);
  const forceNormalize = !!options.forceNormalize;

  if (!forceNormalize && !shouldNormalizeImage(extension)) {
    return {
      ...input,
      tempFilePath,
      fileType: extension || input.fileType || 'jpg',
    };
  }

  try {
    const compressed = await compressImage(tempFilePath, 86);
    const nextPath = compressed && compressed.tempFilePath ? compressed.tempFilePath : tempFilePath;
    return {
      ...input,
      tempFilePath: nextPath,
      fileType: 'jpg',
      originalFileType: extension || input.fileType || '',
    };
  } catch (error) {
    return {
      ...input,
      tempFilePath,
      fileType: extension || input.fileType || 'jpg',
      normalizeFailed: true,
    };
  }
}

async function ensureCanvasCompatibleImage(src) {
  const target = typeof src === 'string' ? src : '';
  if (!target) {
    return '';
  }
  try {
    await getImageInfo(target);
    return target;
  } catch (error) {
    const normalized = await ensureCompatibleImage(target, { forceNormalize: true });
    return normalized && normalized.tempFilePath ? normalized.tempFilePath : target;
  }
}

async function chooseImage(count = 9) {
  const result = await chooseMedia({
    count,
    mediaType: ['image'],
    sourceType: ['camera', 'album'],
    sizeType: ['compressed'],
  });
  const normalizedFiles = await Promise.all(
    ((result && result.tempFiles) || []).map((item) => ensureCompatibleImage(item))
  );
  return {
    ...result,
    tempFiles: normalizedFiles,
  };
}

function chooseVideo(count = 1) {
  return chooseMedia({
      count,
      mediaType: ['video'],
      sourceType: ['camera', 'album'],
      maxDuration: 60,
      camera: 'back',
  });
}

module.exports = {
  chooseImage,
  chooseVideo,
  ensureCanvasCompatibleImage,
  inferExtension,
};

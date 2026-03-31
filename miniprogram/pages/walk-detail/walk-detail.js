const { getWalkDetail, publishWalkShare } = require('../../services/walk');
const { formatDate } = require('../../utils/format');

function splitPoemLines(poem) {
  const normalized = String(poem || '').replace(/[。！？]+$/g, '');
  const lines = normalized
    .split(/[，、；]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (lines.length) {
    return lines;
  }
  const compact = normalized.replace(/\s+/g, '');
  const result = [];
  for (let index = 0; index < compact.length; index += 6) {
    result.push(compact.slice(index, index + 6));
  }
  return result.filter(Boolean);
}

function splitPoemColumns(poemLines) {
  return (poemLines || []).map((line) => String(line || '').split('').filter(Boolean));
}

function decorateSticker(sticker) {
  if (!sticker) {
    return null;
  }
  const poemLines = Array.isArray(sticker.poemLines) && sticker.poemLines.length
    ? sticker.poemLines
    : splitPoemLines(sticker.poem);
  return {
    ...sticker,
    poemLines,
    poemColumns: Array.isArray(sticker.poemColumns) && sticker.poemColumns.length
      ? sticker.poemColumns
      : splitPoemColumns(poemLines),
  };
}

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: resolve,
      fail: reject,
    });
  });
}

function saveImageToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: resolve,
      fail: reject,
    });
  });
}

Page({
  data: {
    loading: true,
    source: 'history',
    walk: null,
    showStickerModal: false,
    isPublishingShare: false,
  },

  onLoad(query) {
    this.setData({ source: query.source || 'history' });
    if (query.id) {
      this.fetchDetail(query.id);
    } else {
      this.setData({ loading: false });
    }
  },

  onShareAppMessage() {
    const walk = this.data.walk;
    return {
      title: walk ? `${walk.themeTitle}｜我的城市漫步贴纸` : '城市漫步贴纸',
      path: walk ? `/pages/walk-detail/walk-detail?id=${walk.id || walk._id}&source=share` : '/pages/history/history',
      imageUrl: walk && walk.sticker ? walk.sticker.imageUrl : '',
    };
  },

  async fetchDetail(id) {
    this.setData({ loading: true });
    try {
      const result = await getWalkDetail({ id });
      const walk = result.walk
        ? {
            ...result.walk,
            sticker: decorateSticker(result.walk.sticker),
            createdAtLabel: formatDate(result.walk.createdAt),
            missionItems: ((result.walk.themeSnapshot && result.walk.themeSnapshot.missions) || []).map((mission) => ({
              mission,
              review: result.walk.missionReviews && result.walk.missionReviews[mission] ? result.walk.missionReviews[mission] : null,
              assets: result.walk.missionAssetMap && result.walk.missionAssetMap[mission] ? result.walk.missionAssetMap[mission] : null,
            })),
          }
        : null;
      this.setData({ walk });
    } catch (error) {
      wx.showToast({ title: '详情加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  openStickerModal() {
    if (!(this.data.walk && this.data.walk.sticker)) {
      return;
    }
    this.setData({ showStickerModal: true });
  },

  closeStickerModal() {
    this.setData({ showStickerModal: false });
  },

  resolveStickerUrl() {
    const sticker = this.data.walk && this.data.walk.sticker;
    if (!sticker) {
      return Promise.reject(new Error('missing_sticker'));
    }
    const src = sticker.imageUrl || sticker.backgroundUrl || '';
    if (!src) {
      return Promise.reject(new Error('missing_sticker_image'));
    }
    if (String(src).startsWith('cloud://')) {
      return wx.cloud.getTempFileURL({ fileList: [src] }).then((result) => {
        const item = result.fileList && result.fileList[0];
        return item && item.tempFileURL ? item.tempFileURL : '';
      });
    }
    return Promise.resolve(src);
  },

  async handleSaveStickerToAlbum() {
    try {
      const imageUrl = await this.resolveStickerUrl();
      if (!imageUrl) {
        throw new Error('missing_sticker_image');
      }
      const download = await downloadFile(imageUrl);
      if (!download || !download.tempFilePath) {
        throw new Error('download_sticker_failed');
      }
      await saveImageToAlbum(download.tempFilePath);
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (error) {
      const errMsg = String((error && error.errMsg) || (error && error.message) || '');
      if (errMsg.includes('auth deny') || errMsg.includes('authorize')) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置里允许保存到相册后，再试一次',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) {
              wx.openSetting({});
            }
          },
        });
        return;
      }
      wx.showToast({ title: '保存贴纸失败', icon: 'none' });
    }
  },

  async handlePublishShare() {
    if (!(this.data.walk && (this.data.walk.id || this.data.walk._id))) {
      wx.showToast({ title: '缺少漫步记录', icon: 'none' });
      return;
    }
    if (this.data.walk.isPublic) {
      wx.showToast({ title: '已可分享，点右侧按钮发送', icon: 'none' });
      return;
    }
    this.setData({ isPublishingShare: true });
    try {
      const result = await publishWalkShare({ id: this.data.walk.id || this.data.walk._id });
      if (result && result.walk) {
        this.setData({
          walk: {
            ...this.data.walk,
            ...result.walk,
            sticker: decorateSticker(result.walk.sticker),
          },
        });
      }
      wx.showToast({ title: '已发布，可分享给好友', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: '发布分享失败', icon: 'none' });
    } finally {
      this.setData({ isPublishingShare: false });
    }
  },

  noop() {},
});

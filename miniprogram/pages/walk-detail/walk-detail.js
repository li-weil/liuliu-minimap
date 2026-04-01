const { getWalkDetail, publishWalkShare, deleteWalk } = require('../../services/walk');
const { formatDate } = require('../../utils/format');

const SUMMARY_MISSION_KEY = '__summary__';
const SUMMARY_MISSION_LABEL = '花些时间回顾一路的采撷';

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

function createEmptyMissionAssets() {
  return {
    photoList: [],
    videoList: [],
    audioList: [],
    noteText: '',
    cardImagePath: '',
  };
}

function buildMissionItems(walk) {
  const missionKeySet = new Set();
  const missionNames = [];
  const missionAssetMap = walk.missionAssetMap || {};
  const pushMission = (mission, isSupplemental = false) => {
    if (!mission || mission === SUMMARY_MISSION_KEY || missionKeySet.has(mission)) {
      return;
    }
    missionKeySet.add(mission);
    missionNames.push({
      key: mission,
      label: mission,
      isSupplemental,
    });
  };

  ((walk.themeSnapshot && walk.themeSnapshot.missions) || []).forEach((mission) => pushMission(mission, false));
  (walk.completedMissions || []).forEach((mission) => pushMission(mission, false));
  Object.keys(walk.missionReviews || {}).forEach((mission) => pushMission(mission, false));
  Object.keys(missionAssetMap || {}).forEach((mission) => pushMission(mission, false));

  missionNames.push({
    key: SUMMARY_MISSION_KEY,
    label: SUMMARY_MISSION_LABEL,
    isSupplemental: true,
  });
  return missionNames.map((item) => ({
    mission: item.key,
    label: item.label,
    isSupplemental: item.isSupplemental,
    review: walk.missionReviews && walk.missionReviews[item.key] ? walk.missionReviews[item.key] : null,
    assets: {
      ...createEmptyMissionAssets(),
      ...(missionAssetMap[item.key] || {}),
    },
  }));
}

Page({
  data: {
    loading: true,
    source: 'history',
    walk: null,
    activeMission: '',
    currentMissionCardSrc: '',
    isRenderingMissionCard: false,
    missionCardRenderPayload: {
      mission: '',
      assets: null,
      locationName: '',
      themeTitle: '',
      dateLabel: '',
      renderVersion: 0,
    },
    showStickerModal: false,
    showMissionCardModal: false,
    missionCardModal: {
      title: '',
      imageSrc: '',
    },
    isPublishingShare: false,
    isDeletingWalk: false,
  },

  onLoad(query) {
    this.missionCardRenderVersion = 0;
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
            missionItems: buildMissionItems(result.walk),
          }
        : null;
      this.setData({
        walk,
        activeMission: walk && walk.missionItems && walk.missionItems.length ? walk.missionItems[0].mission : '',
      }, () => {
        this.prepareMissionCard();
      });
    } catch (error) {
      wx.showToast({ title: '详情加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  getActiveMissionItem() {
    const walk = this.data.walk;
    const activeMission = this.data.activeMission;
    if (!walk || !Array.isArray(walk.missionItems) || !activeMission) {
      return null;
    }
    return walk.missionItems.find((item) => item.mission === activeMission) || null;
  },

  prepareMissionCard() {
    const missionItem = this.getActiveMissionItem();
    if (!missionItem) {
      this.setData({
        currentMissionCardSrc: '',
        isRenderingMissionCard: false,
        missionCardRenderPayload: {
          mission: '',
          assets: null,
          locationName: '',
          themeTitle: '',
          dateLabel: '',
          renderVersion: 0,
        },
      });
      return;
    }

    this.missionCardRenderVersion += 1;
    this.setData({
      currentMissionCardSrc: '',
      isRenderingMissionCard: true,
      missionCardRenderPayload: {
        mission: missionItem.label || '打卡卡片',
        assets: missionItem.assets || createEmptyMissionAssets(),
        locationName: (this.data.walk && this.data.walk.locationName) || '',
        themeTitle: (this.data.walk && this.data.walk.themeTitle) || '',
        dateLabel: (this.data.walk && this.data.walk.createdAtLabel) || '',
        renderVersion: this.missionCardRenderVersion,
      },
    });
  },

  handleMissionCardGenerated(event) {
    const tempFilePath = event.detail && event.detail.tempFilePath ? event.detail.tempFilePath : '';
    const mission = event.detail && event.detail.mission ? event.detail.mission : '';
    const activeMissionItem = this.getActiveMissionItem();
    const activeMissionLabel = activeMissionItem ? activeMissionItem.label : '';
    if (!tempFilePath || !activeMissionLabel || mission !== activeMissionLabel) {
      return;
    }
    this.setData({
      currentMissionCardSrc: tempFilePath,
      isRenderingMissionCard: false,
    });
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

  openMissionCardModal(event) {
    const imageSrc = event.currentTarget.dataset.src || this.data.currentMissionCardSrc || '';
    const title = event.currentTarget.dataset.title || this.data.missionCardRenderPayload.mission || '打卡卡片';
    if (!imageSrc) {
      return;
    }
    this.setData({
      showMissionCardModal: true,
      missionCardModal: {
        title,
        imageSrc,
      },
    });
  },

  closeMissionCardModal() {
    this.setData({
      showMissionCardModal: false,
      missionCardModal: {
        title: '',
        imageSrc: '',
      },
    });
  },

  resolveMissionCardUrl() {
    const src = this.data.missionCardModal && this.data.missionCardModal.imageSrc;
    if (!src) {
      return Promise.reject(new Error('missing_mission_card'));
    }
    if (String(src).startsWith('cloud://')) {
      return wx.cloud.getTempFileURL({ fileList: [src] }).then((result) => {
        const item = result.fileList && result.fileList[0];
        return item && item.tempFileURL ? item.tempFileURL : '';
      });
    }
    return Promise.resolve(src);
  },

  async handleSaveMissionCardToAlbum() {
    try {
      const imageUrl = await this.resolveMissionCardUrl();
      if (!imageUrl) {
        throw new Error('missing_mission_card');
      }
      const download = await downloadFile(imageUrl);
      if (!download || !download.tempFilePath) {
        throw new Error('download_mission_card_failed');
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
      wx.showToast({ title: '保存卡片失败', icon: 'none' });
    }
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

  async handleDeleteWalk() {
    const walk = this.data.walk;
    const id = walk && (walk.id || walk._id);
    if (!id || this.data.isDeletingWalk) {
      return;
    }

    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '删除这条历史记录？',
        content: '删除后将无法恢复，这条漫步的任务、轨迹、图片、视频和录音记录都会从历史中移除。',
        confirmText: '确认删除',
        confirmColor: '#c24f35',
        cancelText: '取消',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false),
      });
    });

    if (!confirm) {
      return;
    }

    this.setData({ isDeletingWalk: true });
    try {
      const result = await deleteWalk({ id });
      if (!result || !result.ok) {
        throw new Error((result && result.reason) || 'delete_failed');
      }
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack({
          fail: () => {
            wx.switchTab({ url: '/pages/history/history' });
          },
        });
      }, 400);
    } catch (error) {
      wx.showToast({ title: '删除失败', icon: 'none' });
    } finally {
      this.setData({ isDeletingWalk: false });
    }
  },

  switchMissionTab(event) {
    const mission = event.currentTarget.dataset.mission;
    const nextMission = this.data.activeMission === mission ? '' : mission;
    this.setData({
      activeMission: nextMission,
    }, () => {
      this.prepareMissionCard();
    });
  },

  noop() {},
});

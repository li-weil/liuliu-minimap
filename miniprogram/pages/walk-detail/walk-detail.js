const { createWalk, getWalkDetail, publishWalkShare, deleteWalk } = require('../../services/walk');
const { requestUpload } = require('../../services/api');
const { batchResolveCloudFileIds, isCloudFileId } = require('../../services/asset');
const { ensurePlayableLocalAudio } = require('../../utils/audio');
const { formatDate } = require('../../utils/format');
const {
  createDefaultPrivacyPopup,
  ensurePrivacyAuthorization,
  openPrivacyContract,
  rejectPrivacyAuthorization,
  resolvePrivacyAuthorization,
} = require('../../utils/privacy');

const SUMMARY_MISSION_KEY = '__summary__';
const SUMMARY_MISSION_LABEL = '花些时间回顾一路的采撷';

function explainDeleteFailure(error) {
  const raw = String((error && error.message) || (error && error.errMsg) || '').toLowerCase();
  if (!raw) {
    return '删除失败，请稍后再试';
  }
  if (raw.includes('permission_denied')) {
    return '这条记录不属于当前账号，不能删除';
  }
  if (raw.includes('not_found')) {
    return '这条记录已经不存在了';
  }
  if (raw.includes('missing_id')) {
    return '缺少记录编号，暂时无法删除';
  }
  if (raw.includes('walk_not_finished')) {
    return '进行中的漫步还不能删除，请先完成并保存';
  }
  if (raw.includes('function not found') || raw.includes('cloud function')) {
    return '删除云函数还没部署，请先上传 deleteWalk';
  }
  return '删除失败，请稍后再试';
}

function queryCanDelete(walk, source) {
  if (!walk) {
    return false;
  }
  if (source === 'feed' || source === 'share') {
    return false;
  }
  return !!(walk.id || walk._id);
}

function queryCanShare(walk, source) {
  if (!walk) {
    return false;
  }
  if (source === 'feed' || source === 'share') {
    return false;
  }
  if (walk.status !== 'finished') {
    return false;
  }
  return !!(walk.id || walk._id);
}

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

function saveImageToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: resolve,
      fail: reject,
    });
  });
}

function getSetting() {
  return new Promise((resolve, reject) => {
    wx.getSetting({
      success: resolve,
      fail: reject,
    });
  });
}

function authorize(scope) {
  return new Promise((resolve, reject) => {
    wx.authorize({
      scope,
      success: resolve,
      fail: reject,
    });
  });
}

function openSetting() {
  return new Promise((resolve, reject) => {
    wx.openSetting({
      success: resolve,
      fail: reject,
    });
  });
}

async function ensureAlbumPermission() {
  const setting = await getSetting();
  const authSetting = setting && setting.authSetting ? setting.authSetting : {};
  const albumPermission = authSetting['scope.writePhotosAlbum'];
  if (albumPermission === true) {
    return true;
  }
  if (albumPermission === false) {
    const modalResult = await new Promise((resolve) => {
      wx.showModal({
        title: '需要相册权限',
        content: '请在设置里允许保存到相册后，再试一次',
        confirmText: '去设置',
        success: resolve,
      });
    });
    if (!modalResult || !modalResult.confirm) {
      throw new Error('album_permission_denied');
    }
    const openedSetting = await openSetting();
    const nextAuthSetting = openedSetting && openedSetting.authSetting ? openedSetting.authSetting : {};
    if (!nextAuthSetting['scope.writePhotosAlbum']) {
      throw new Error('album_permission_denied');
    }
    return true;
  }

  try {
    await authorize('scope.writePhotosAlbum');
    return true;
  } catch (error) {
    const errMsg = String((error && error.errMsg) || (error && error.message) || '');
    if (errMsg.includes('auth deny') || errMsg.includes('authorize')) {
      throw new Error('album_permission_denied');
    }
    throw error;
  }
}

function explainAlbumSaveError(error) {
  const errMsg = String((error && error.errMsg) || (error && error.message) || '');
  if (!errMsg) {
    return '保存卡片失败，请稍后再试';
  }
  if (
    errMsg.includes('auth deny') ||
    errMsg.includes('authorize') ||
    errMsg.includes('album_permission_denied') ||
    errMsg.includes('saveImageToPhotosAlbum:fail auth denied')
  ) {
    return '没有相册权限，请到设置里开启';
  }
  if (errMsg.includes('download_status_')) {
    return `卡片下载失败：${errMsg.replace('download_status_', 'HTTP ')}`.slice(0, 30);
  }
  if (errMsg.includes('download_mission_card_failed') || errMsg.includes('download file:fail')) {
    return '卡片下载失败，请稍后重试';
  }
  if (errMsg.includes('fail file not found')) {
    return '卡片文件已失效，请重新生成';
  }
  if (errMsg.includes('saveImageToPhotosAlbum:fail')) {
    return errMsg.replace('saveImageToPhotosAlbum:fail ', '').slice(0, 30);
  }
  return `保存失败：${errMsg}`.slice(0, 30);
}

function createEmptyMissionAssets() {
  return {
    photoList: [],
    videoList: [],
    audioList: [],
    noteText: '',
    companionNote: '',
    cardImagePath: '',
  };
}

function countList(list) {
  return Array.isArray(list) ? list.filter(Boolean).length : 0;
}

function countMissionEvidence(assets) {
  const safeAssets = assets || {};
  const noteText = String(safeAssets.noteText || '').trim();
  const companionNote = String(safeAssets.companionNote || '').trim();
  return countList(safeAssets.photoList)
    + countList(safeAssets.videoList)
    + countList(safeAssets.audioList)
    + (noteText ? 1 : 0)
    + (companionNote ? 1 : 0);
}

function normalizeMissionKey(item) {
  if (typeof item === 'string') {
    return item;
  }
  if (!item || typeof item !== 'object') {
    return '';
  }
  return item.mission || item.key || item.label || '';
}

function getCompletedMissionList(walk) {
  const source = Array.isArray(walk && walk.completedMissions)
    ? walk.completedMissions
    : Array.isArray(walk && walk.missionsCompleted)
      ? walk.missionsCompleted
      : [];
  return source.map(normalizeMissionKey).filter(Boolean);
}

function hasMissionCheckIn(walk, mission) {
  if (!mission) {
    return false;
  }
  const review = walk && walk.missionReviews ? walk.missionReviews[mission] : null;
  if (review && review.status === 'needs_recheck') {
    return false;
  }
  const completedSet = new Set(getCompletedMissionList(walk));
  if (completedSet.has(mission)) {
    return true;
  }
  if (!review) {
    return false;
  }
  return review.status === 'checked_in' || !!review.checkedInAt || review.passed === true;
}

function buildMissionItems(walk) {
  const missionAssetMap = walk.missionAssetMap || {};
  const themeMissions = Array.isArray(walk.themeSnapshot && walk.themeSnapshot.missions)
    ? walk.themeSnapshot.missions.filter((mission) => !!mission && mission !== SUMMARY_MISSION_KEY)
    : [];
  const missionNames = [
    ...themeMissions.map((mission) => ({
      key: mission,
      label: mission,
      isSupplemental: false,
    })),
    {
      key: SUMMARY_MISSION_KEY,
      label: SUMMARY_MISSION_LABEL,
      isSupplemental: true,
    },
  ];
  return missionNames.map((item) => {
    const assets = {
      ...createEmptyMissionAssets(),
      ...(missionAssetMap[item.key] || {}),
    };
    const evidenceCount = countMissionEvidence(assets);
    const isCompleted = hasMissionCheckIn(walk, item.key);
    return {
      mission: item.key,
      label: item.label,
      isSupplemental: item.isSupplemental,
      isCompleted,
      statusLabel: isCompleted ? '已完成' : (evidenceCount ? '已记录' : '待回看'),
      photoCount: countList(assets.photoList),
      videoCount: countList(assets.videoList),
      audioCount: countList(assets.audioList),
      evidenceCount,
      hasNote: !!String(assets.noteText || '').trim(),
      hasCompanionNote: !!String(assets.companionNote || '').trim(),
      hasCard: !!assets.cardImagePath,
      review: walk.missionReviews && walk.missionReviews[item.key] ? walk.missionReviews[item.key] : null,
      assets,
    };
  });
}

async function downloadAudioToLocal(src) {
  if (!src) {
    return '';
  }
  let finalUrl = src;
  if (isCloudFileId(src)) {
    const resolvedMap = await batchResolveCloudFileIds([src]).catch(() => ({}));
    finalUrl = resolvedMap[src] || '';
  }
  if (!finalUrl) {
    return src;
  }
  if (!/^https?:\/\//i.test(String(finalUrl))) {
    return finalUrl;
  }
  return ensurePlayableLocalAudio(finalUrl, {
    cacheKey: src,
    sourceHint: src,
    filePrefix: 'walk-audio',
  }).catch(() => finalUrl);
}

async function hydrateMissionItemsAudio(missionItems = []) {
  const cache = {};
  return Promise.all((missionItems || []).map(async (missionItem) => {
    const assets = missionItem && missionItem.assets ? missionItem.assets : {};
    const audioList = await Promise.all((assets.audioList || []).map(async (item) => {
      const src = item && item.tempFilePath ? item.tempFilePath : item;
      if (!src) {
        return item;
      }
      if (!cache[src]) {
        cache[src] = downloadAudioToLocal(src).catch(() => src);
      }
      return cache[src];
    }));
    return {
      ...missionItem,
      assets: {
        ...assets,
        audioList,
      },
    };
  }));
}

function getMapCenter(routePoints, fallbackLocation = {}) {
  const points = (Array.isArray(routePoints) ? routePoints : [])
    .map((point) => ({
      latitude: Number(point && point.latitude),
      longitude: Number(point && point.longitude),
    }))
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
  if (points.length) {
    return points[points.length - 1];
  }

  const fallbackLatitude = Number(fallbackLocation.latitude);
  const fallbackLongitude = Number(fallbackLocation.longitude);
  if (Number.isFinite(fallbackLatitude) && Number.isFinite(fallbackLongitude)) {
    return {
      latitude: fallbackLatitude,
      longitude: fallbackLongitude,
    };
  }

  return {
    latitude: 39.908823,
    longitude: 116.39747,
  };
}

function hasCardGenerationMaterial(assets) {
  const noteText = String((assets && assets.noteText) || '').trim();
  const photoList = Array.isArray(assets && assets.photoList) ? assets.photoList.filter(Boolean) : [];
  return !!noteText || photoList.length > 0;
}

function buildDetailMetrics(walk, missionItems) {
  const safeWalk = walk || {};
  const items = Array.isArray(missionItems) ? missionItems : [];
  const taskItems = items.filter((item) => item && !item.isSupplemental);
  const completedCount = taskItems.filter((item) => item && item.isCompleted).length;
  const missionTotalCount = taskItems.length;
  const evidenceCount = items.reduce((total, item) => total + Number((item && item.evidenceCount) || 0), 0);
  const photoCount = items.reduce((total, item) => total + Number((item && item.photoCount) || 0), 0);
  const videoCount = items.reduce((total, item) => total + Number((item && item.videoCount) || 0), 0);
  const audioCount = items.reduce((total, item) => total + Number((item && item.audioCount) || 0), 0);
  const noteCount = items.filter((item) => item && (item.hasNote || item.hasCompanionNote)).length;
  const missionProgressPercent = missionTotalCount
    ? Math.round((completedCount / missionTotalCount) * 100)
    : 0;
  return {
    sourceLabel: safeWalk.sourceLabel || '',
    statusLabel: safeWalk.status === 'active' ? '进行中' : '已结束',
    visibilityLabel: safeWalk.isPublic ? '可分享给好友' : '仅自己可见',
    modeLabel: safeWalk.walkMode === 'advanced' ? '进阶模式' : '纯粹模式',
    completedCount,
    missionTotalCount,
    missionProgressPercent,
    evidenceCount,
    photoCount,
    videoCount,
    audioCount,
    noteCount,
    routePointCount: countList(safeWalk.routePoints),
    hasRoute: countList(safeWalk.routePoints) > 0,
    hasSticker: !!safeWalk.sticker,
  };
}

Page({
  data: {
    loading: true,
    source: 'history',
    walk: null,
    canResume: false,
    activeMission: '',
    currentMissionCardSrc: '',
    isRenderingMissionCard: false,
    missionCardPendingNote: false,
    missionCardPendingText: '',
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
    isDeletingWalk: false,
    mapCenterLatitude: 39.908823,
    mapCenterLongitude: 116.39747,
    privacyPopup: createDefaultPrivacyPopup(),
  },

  onLoad(query) {
    this.missionCardRenderVersion = 0;
    this.pendingMissionRefreshTimer = null;
    this.setData({ source: query.source || 'history' });
    if (query.id) {
      this.fetchDetail(query.id);
    } else {
      this.setData({ loading: false });
    }
  },

  onUnload() {
    this.clearPendingMissionRefresh();
  },

  clearPendingMissionRefresh() {
    if (this.pendingMissionRefreshTimer) {
      clearTimeout(this.pendingMissionRefreshTimer);
      this.pendingMissionRefreshTimer = null;
    }
  },

  schedulePendingMissionRefresh() {
    const walk = this.data.walk;
    const walkId = walk && (walk.id || walk._id);
    if (!walkId || this.pendingMissionRefreshTimer) {
      return;
    }
    this.pendingMissionRefreshTimer = setTimeout(() => {
      this.pendingMissionRefreshTimer = null;
      if (this.data.isRenderingMissionCard) {
        return;
      }
      this.fetchDetail(walkId);
    }, 3000);
  },

  onShareAppMessage() {
    const walk = this.data.walk;
    return {
      title: `遛遛｜邀请你看我的漫步记录` ,
      path: walk ? `/pages/walk-detail/walk-detail?id=${walk.id || walk._id}&source=share` : '/pages/history/history',
      imageUrl: walk && (walk.coverImage || (walk.sticker && walk.sticker.imageUrl) || ''),
    };
  },

  async fetchDetail(id) {
    this.setData({ loading: true });
    try {
      const result = await getWalkDetail({ id });
      const baseMissionItems = result.walk ? buildMissionItems(result.walk) : [];
      const missionItems = await hydrateMissionItemsAudio(baseMissionItems);
      const walk = result.walk
        ? {
            ...result.walk,
            sticker: decorateSticker(result.walk.sticker),
            createdAtLabel: formatDate(result.walk.createdAt),
            missionItems,
            detailMetrics: buildDetailMetrics(result.walk, missionItems),
            canDelete: queryCanDelete(result.walk, this.data.source),
            canShare: queryCanShare(result.walk, this.data.source),
          }
        : null;
      const mapCenter = getMapCenter(walk && walk.routePoints, walk);
      this.setData({
        walk,
        canResume: !!(walk && walk.status === 'active'),
        activeMission: walk && walk.missionItems && walk.missionItems.length ? walk.missionItems[0].mission : '',
        mapCenterLatitude: mapCenter.latitude,
        mapCenterLongitude: mapCenter.longitude,
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

  async prepareMissionCard() {
    const missionItem = this.getActiveMissionItem();
    if (!missionItem) {
      this.clearPendingMissionRefresh();
      this.setData({
        currentMissionCardSrc: '',
        isRenderingMissionCard: false,
        missionCardPendingNote: false,
        missionCardPendingText: '',
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
    const missionAssets = {
      ...createEmptyMissionAssets(),
      ...(missionItem.assets || {}),
    };
    const companionNoteStatus = String((missionItem.review && missionItem.review.companionNoteStatus) || '').trim();
    const waitingCompanionNote = !missionAssets.cardImagePath
      && hasCardGenerationMaterial(missionAssets)
      && !String(missionAssets.companionNote || '').trim()
      && companionNoteStatus === 'pending';
    if (waitingCompanionNote) {
      this.schedulePendingMissionRefresh();
    } else {
      this.clearPendingMissionRefresh();
    }
    this.setData({
      currentMissionCardSrc: missionAssets.cardImagePath || '',
      isRenderingMissionCard: false,
      missionCardPendingNote: waitingCompanionNote,
      missionCardPendingText: waitingCompanionNote ? '66 正在记录卡片…' : '',
      missionCardRenderPayload: {
        mission: missionItem.label || '打卡卡片',
        assets: missionAssets,
        locationName: (this.data.walk && this.data.walk.locationName) || '',
        themeTitle: (this.data.walk && this.data.walk.themeTitle) || '',
        dateLabel: (this.data.walk && this.data.walk.createdAtLabel) || '',
        renderVersion: 0,
      },
    });
  },

  handleGenerateMissionCard() {
    const missionItem = this.getActiveMissionItem();
    if (!missionItem) {
      wx.showToast({ title: '先选择一个任务', icon: 'none' });
      return;
    }
    const missionAssets = {
      ...createEmptyMissionAssets(),
      ...(missionItem.assets || {}),
    };
    const companionNoteStatus = String((missionItem.review && missionItem.review.companionNoteStatus) || '').trim();
    if (
      !missionAssets.cardImagePath
      && hasCardGenerationMaterial(missionAssets)
      && !String(missionAssets.companionNote || '').trim()
      && companionNoteStatus === 'pending'
    ) {
      wx.showToast({ title: '66 正在准备卡片文案', icon: 'none' });
      this.setData({
        missionCardPendingNote: true,
        missionCardPendingText: '66 正在记录卡片…',
      });
      this.schedulePendingMissionRefresh();
      return;
    }
    this.missionCardRenderVersion += 1;
    this.setData({
      currentMissionCardSrc: '',
      isRenderingMissionCard: true,
      missionCardPendingNote: false,
      missionCardPendingText: '',
      missionCardRenderPayload: {
        mission: missionItem.label || '打卡卡片',
        assets: missionAssets,
        locationName: (this.data.walk && this.data.walk.locationName) || '',
        themeTitle: (this.data.walk && this.data.walk.themeTitle) || '',
        dateLabel: (this.data.walk && this.data.walk.createdAtLabel) || '',
        renderVersion: this.missionCardRenderVersion,
      },
    });
  },

  async persistMissionCard(missionKey, tempFilePath) {
    const walk = this.data.walk;
    const walkId = walk && (walk.id || walk._id);
    if (!walk || !walkId || !missionKey || !tempFilePath) {
      return '';
    }
    const cardImagePath = await requestUpload(tempFilePath, { kind: 'image' });
    const missionAssetMap = {
      ...(walk.missionAssetMap || {}),
      [missionKey]: {
        ...createEmptyMissionAssets(),
        ...(((walk.missionAssetMap || {})[missionKey]) || {}),
        cardImagePath,
      },
    };
    const result = await createWalk({
      id: walkId,
      themeSnapshot: walk.themeSnapshot,
      locationName: walk.locationName,
      locationAddress: walk.locationAddress,
      latitude: walk.latitude,
      longitude: walk.longitude,
      routePoints: walk.routePoints || [],
      missionsCompleted: walk.completedMissions || [],
      missionReviews: walk.missionReviews || {},
      missionAssetMap,
      photoList: walk.photoList || [],
      videoList: walk.videoList || [],
      audioList: walk.audioList || [],
      noteText: walk.noteText || '',
      isPublic: !!walk.isPublic,
      walkMode: walk.walkMode,
      generationSource: walk.generationSource,
      season: walk.season || '',
      generationContext: walk.generationContext || {},
      trackStartedAt: walk.trackStartedAt,
      trackStoppedAt: walk.trackStoppedAt,
      startedAt: walk.startedAt,
      endedAt: walk.endedAt,
      routeStats: walk.routeStats || {},
      sticker: walk.sticker || null,
      status: walk.status || 'finished',
    });
    const persistedWalk = result && result.walk ? result.walk : { ...walk, missionAssetMap };
    const persistedMissionItems = buildMissionItems(persistedWalk);
    this.setData({
      walk: {
        ...persistedWalk,
        sticker: decorateSticker(persistedWalk.sticker),
        createdAtLabel: formatDate(persistedWalk.createdAt),
        missionItems: persistedMissionItems,
        detailMetrics: buildDetailMetrics(persistedWalk, persistedMissionItems),
        canDelete: queryCanDelete(persistedWalk, this.data.source),
        canShare: queryCanShare(persistedWalk, this.data.source),
      },
    });
    return cardImagePath;
  },

  async handleMissionCardGenerated(event) {
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
      missionCardRenderPayload: {
        ...this.data.missionCardRenderPayload,
        renderVersion: 0,
      },
    });
    if (!activeMissionItem || !activeMissionItem.mission) {
      return;
    }
    try {
      await this.persistMissionCard(activeMissionItem.mission, tempFilePath);
    } catch (error) {
      wx.showToast({ title: '卡片已生成，持久化失败', icon: 'none' });
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

  resolveMissionCardFilePath() {
    const src = this.data.missionCardModal && this.data.missionCardModal.imageSrc;
    if (!src) {
      return Promise.reject(new Error('missing_mission_card'));
    }
    const normalizedSrc = String(src);
    if (normalizedSrc.startsWith('cloud://')) {
      return wx.cloud.getTempFileURL({ fileList: [src] }).then((result) => {
        const item = result.fileList && result.fileList[0];
        return item && item.tempFileURL ? downloadFile(item.tempFileURL) : null;
      }).then((download) => {
        if (!download || !download.tempFilePath) {
          throw new Error('download_mission_card_failed');
        }
        return download.tempFilePath;
      });
    }
    if (/^https?:\/\//i.test(normalizedSrc)) {
      return downloadFile(normalizedSrc).then((download) => {
        if (!download || !download.tempFilePath) {
          throw new Error('download_mission_card_failed');
        }
        return download.tempFilePath;
      });
    }
    return Promise.resolve(normalizedSrc);
  },

  async handleSaveMissionCardToAlbum() {
    try {
      await ensurePrivacyAuthorization(this, {
        title: '保存到相册前说明',
        content: '保存到本地时会使用相册相关能力，仅用于把这张打卡卡片存到你的设备相册中。',
      });
      await ensureAlbumPermission();
      const filePath = await this.resolveMissionCardFilePath();
      if (!filePath) {
        throw new Error('missing_mission_card');
      }
      await saveImageToAlbum(filePath);
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (error) {
      if (error && error.message === 'privacy_authorization_denied') {
        wx.showToast({ title: '未同意隐私说明，暂时无法保存', icon: 'none' });
        return;
      }
      wx.showModal({
        title: '保存卡片失败',
        content: explainAlbumSaveError(error),
        showCancel: false,
        confirmText: '知道了',
      });
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
      await ensurePrivacyAuthorization(this, {
        title: '保存到相册前说明',
        content: '保存贴纸到本地时会使用相册相关能力，仅用于把这张贴纸存到你的设备相册中。',
      });
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
      if (error && error.message === 'privacy_authorization_denied') {
        wx.showToast({ title: '未同意隐私说明，暂时无法保存', icon: 'none' });
        return;
      }
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

  handleShareTap() {
    if (!(this.data.walk && (this.data.walk.id || this.data.walk._id))) {
      wx.showToast({ title: '缺少漫步记录', icon: 'none' });
      return;
    }
    if (this.data.walk.isPublic) {
      return;
    }
    this.setData({
      walk: {
        ...this.data.walk,
        isPublic: true,
      },
    });
    publishWalkShare({ id: this.data.walk.id || this.data.walk._id })
      .then((result) => {
        if (result && result.walk) {
          const nextWalk = {
            ...this.data.walk,
            ...result.walk,
            sticker: decorateSticker(result.walk.sticker),
            canShare: queryCanShare(result.walk, this.data.source),
          };
          const missionItems = Array.isArray(nextWalk.missionItems) && nextWalk.missionItems.length
            ? nextWalk.missionItems
            : buildMissionItems(nextWalk);
          this.setData({
            walk: {
              ...nextWalk,
              missionItems,
              detailMetrics: buildDetailMetrics(nextWalk, missionItems),
            },
          });
        }
      })
      .catch(() => {
        // Ignore publish failure here so the share sheet can proceed immediately.
      });
  },

async handleDeleteWalk() {
    const walk = this.data.walk;
    const id = walk && (walk.id || walk._id);
    if (!id || this.data.isDeletingWalk || !(walk && walk.canDelete)) {
      return;
    }

    if (walk.status !== 'finished') {
      wx.showToast({ title: '进行中的漫步还不能删除', icon: 'none' });
      return;
    }

    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '删除这条历史记录？',
        content: '删除后将无法恢复，这条漫步的任务、位置信息、图片、视频和录音记录都会从历史中移除。',
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
      wx.showToast({ title: explainDeleteFailure(error), icon: 'none', duration: 2500 });
    } finally {
      this.setData({ isDeletingWalk: false });
    }
  },

  handleResumeWalk() {
    const walk = this.data.walk;
    const walkId = walk && (walk.id || walk._id);
    if (!walkId || !this.data.canResume) {
      return;
    }
    wx.navigateTo({
      url: `/pages/record/record?id=${encodeURIComponent(walkId)}`,
    });
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

  handlePrivacyAgree() {
    resolvePrivacyAuthorization(this);
  },

  handlePrivacyReject() {
    rejectPrivacyAuthorization(this);
  },

  handleOpenPrivacyContract() {
    openPrivacyContract().catch(() => {
      wx.showToast({ title: '暂时无法打开隐私指引', icon: 'none' });
    });
  },
});

const app = getApp();
const { createWalk, getWalkDetail } = require('../../services/walk');
const { requestUpload } = require('../../services/api');
const { getCurrentLocation } = require('../../utils/location');
const { chooseImage, chooseVideo } = require('../../utils/media');
const { verifyMission } = require('../../services/theme');
const { generateCompanionNote, generateStickerPlan, generateStickerImage } = require('../../services/sticker');
const { isManualLogoutSuppressed } = require('../../services/user');

let recorderManager = null;
let routeTimer = null;

const TRACK_SAMPLE_INTERVAL_MS = 5000;
const SUMMARY_MISSION_KEY = '__summary__';
const SUMMARY_MISSION_LABEL = '总结与补充';

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

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function getDistanceMeters(from, to) {
  if (!from || !to) {
    return 0;
  }
  const earthRadius = 6371000;
  const lat1 = toRadians(Number(from.latitude));
  const lat2 = toRadians(Number(to.latitude));
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(Number(to.longitude) - Number(from.longitude));
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round((durationMs || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}小时${minutes}分`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }
  return `${seconds}秒`;
}

function formatDistance(distanceMeters) {
  const meters = Number(distanceMeters || 0);
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return '未开始';
  }
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

function buildRouteStats(routePoints, trackStartedAt, trackStoppedAt, isTracking) {
  const points = Array.isArray(routePoints) ? routePoints : [];
  const distanceMeters = points.reduce((total, point, index) => {
    if (index === 0) {
      return total;
    }
    return total + getDistanceMeters(points[index - 1], point);
  }, 0);

  const effectiveStart = trackStartedAt || (points[0] && points[0].timestamp) || null;
  const effectiveEnd =
    trackStoppedAt ||
    (!isTracking && points.length ? points[points.length - 1].timestamp : null) ||
    (isTracking ? Date.now() : effectiveStart);
  const durationMs =
    effectiveStart && effectiveEnd && effectiveEnd >= effectiveStart
      ? effectiveEnd - effectiveStart
      : 0;

  return {
    durationMs,
    pointCount: points.length,
    distanceMeters,
    durationLabel: formatDuration(durationMs),
    distanceLabel: formatDistance(distanceMeters),
    startedLabel: formatDateTime(effectiveStart),
    stoppedLabel: isTracking ? '进行中' : formatDateTime(effectiveEnd),
  };
}

function mergeRouteStatsWithDraft(draft, isTracking) {
  const computed = buildRouteStats(
    draft && draft.routePoints,
    draft && (draft.trackStartedAt || draft.startedAt),
    draft && draft.trackStoppedAt,
    isTracking
  );
  const stored = draft && draft.routeStats ? draft.routeStats : null;
  if (!stored) {
    return computed;
  }

  const durationMs = isTracking ? computed.durationMs : Math.max(Number(stored.durationMs || 0), Number(computed.durationMs || 0));
  const distanceMeters = isTracking ? computed.distanceMeters : Math.max(Number(stored.distanceMeters || 0), Number(computed.distanceMeters || 0));
  const pointCount = isTracking ? computed.pointCount : Math.max(Number(stored.pointCount || 0), Number(computed.pointCount || 0));

  return {
    ...computed,
    durationMs,
    pointCount,
    distanceMeters,
    durationLabel: formatDuration(durationMs),
    distanceLabel: formatDistance(distanceMeters),
  };
}

function normalizeMapRoutePoints(routePoints) {
  return (Array.isArray(routePoints) ? routePoints : [])
    .map((point) => ({
      latitude: Number(point && point.latitude),
      longitude: Number(point && point.longitude),
    }))
    .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
}

function buildMapPolyline(routePoints) {
  const points = normalizeMapRoutePoints(routePoints);
  if (points.length < 2) {
    return [];
  }
  return [{
    points,
    color: '#5a5a40',
    width: 4,
  }];
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

function buildThemeKey(theme, draft) {
  if (!theme) {
    return '';
  }
  return [
    theme.title || '',
    theme.category || '',
    draft && draft.locationName ? draft.locationName : '',
    draft && draft.walkMode ? draft.walkMode : '',
  ].join('::');
}

function ensureMissionAssetMap(missionAssetMap = {}) {
  const nextMap = {};
  Object.keys(missionAssetMap || {}).forEach((mission) => {
    nextMap[mission] = {
      ...createEmptyMissionAssets(),
      ...(missionAssetMap[mission] || {}),
    };
  });
  return nextMap;
}

function syncDraftAggregates(draft) {
  const missionAssetMap = ensureMissionAssetMap(draft.missionAssetMap);
  const summaryAssets = missionAssetMap[SUMMARY_MISSION_KEY] || createEmptyMissionAssets();
  return {
    ...draft,
    missionAssetMap,
    noteText: summaryAssets.noteText || '',
    photoList: [...(summaryAssets.photoList || [])],
    videoList: [...(summaryAssets.videoList || [])],
    audioList: [...(summaryAssets.audioList || [])],
  };
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

function buildDraftFromWalk(walk) {
  if (!walk) {
    return null;
  }
  return syncDraftAggregates({
    walkId: walk.id || walk._id || '',
    status: walk.status || 'active',
    locationName: walk.locationName || '当前位置',
    locationContext: walk.locationContext || '城市街道',
    locationAddress: walk.locationAddress || '',
    latitude: walk.latitude || null,
    longitude: walk.longitude || null,
    routePoints: Array.isArray(walk.routePoints) ? walk.routePoints : [],
    completedMissions: Array.isArray(walk.completedMissions) ? walk.completedMissions : [],
    missionReviews: walk.missionReviews || {},
    missionAssetMap: walk.missionAssetMap || {},
    selectedMission: (walk.themeSnapshot && walk.themeSnapshot.missions && walk.themeSnapshot.missions[0]) || '',
    noteText: walk.noteText || '',
    photoList: Array.isArray(walk.photoList) ? walk.photoList : [],
    videoList: Array.isArray(walk.videoList) ? walk.videoList : [],
    audioList: Array.isArray(walk.audioList) ? walk.audioList : [],
    isPublic: !!walk.isPublic,
    startedAt: walk.startedAt || walk.createdAt || null,
    endedAt: walk.endedAt || null,
    trackStartedAt: walk.trackStartedAt || walk.startedAt || null,
    trackStoppedAt: walk.trackStoppedAt || walk.endedAt || null,
    routeStats: walk.routeStats || {
      durationMs: 0,
      pointCount: 0,
      distanceMeters: 0,
    },
    sticker: walk.sticker || null,
    walkMode: walk.walkMode || 'pure',
    generationSource: walk.generationSource || 'preset',
    season: walk.season || '',
    generationContext: walk.generationContext || {},
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

function saveImageToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: resolve,
      fail: reject,
    });
  });
}

function resolveCloudFileUrl(src) {
  return wx.cloud.getTempFileURL({ fileList: [src] }).then((result) => {
    const item = result.fileList && result.fileList[0];
    return item && item.tempFileURL ? item.tempFileURL : '';
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

Page({
  data: {
    activeMission: '',
    summaryMissionKey: SUMMARY_MISSION_KEY,
    isVerifyingMission: false,
    theme: null,
    draft: null,
    isTracking: false,
    isSaving: false,
    isGeneratingSticker: false,
    showStickerModal: false,
    isMapOpen: false,
    isRecordingAudio: false,
    recordingMission: '',
    expandedMission: '',
    generatedMissionCardMap: {},
    showMissionCardModal: false,
    generatingMissionCard: '',
    missionCardModal: {
      mission: '',
      imageSrc: '',
      isGenerating: false,
    },
    missionCardRenderPayload: {
      mission: '',
      assets: null,
      renderVersion: 0,
    },
    routeStats: {
      durationMs: 0,
      pointCount: 0,
      distanceMeters: 0,
      durationLabel: '0秒',
      distanceLabel: '0 m',
      startedLabel: '未开始',
      stoppedLabel: '未开始',
    },
    mapPolyline: [],
  },

  async onLoad(query) {
    this.currentWalkId = query && (query.id || query.walkId) ? (query.id || query.walkId) : '';
    if (wx.getRecorderManager) {
      recorderManager = wx.getRecorderManager();
      recorderManager.onStop((result) => {
        const nextAudio = {
          tempFilePath: result.tempFilePath,
          duration: result.duration || 0,
        };
        const mission = this.recordingMission || this.getActiveMissionKey();
        let draft = { ...app.globalData.walkDraft };
        draft = this.attachMissionAsset(draft, mission, 'audioList', nextAudio);
        this.setDraft(draft);
        this.setData({ isRecordingAudio: false, recordingMission: '' });
        this.recordingMission = '';
        this.refreshState();
      });
      recorderManager.onError(() => {
        this.setData({ isRecordingAudio: false, recordingMission: '' });
        this.recordingMission = '';
        wx.showToast({ title: '录音失败', icon: 'none' });
      });
    }
    this.handleRealtimeLocationChange = (location) => {
      this.appendTrackPoint(location);
    };
    this.trackingMode = '';
    this.recordingMission = '';
    this.generatedMissionCardMap = {};
    if (this.currentWalkId) {
      await this.restoreWalkContext(this.currentWalkId);
    }
  },

  onShow() {
    this.refreshState();
  },

  onUnload() {
    this.stopTracking();
    if (this.data.isRecordingAudio && recorderManager) {
      recorderManager.stop();
    }
  },

  async restoreWalkContext(walkId) {
    const cachedDraft = app.getWalkDraft(walkId);
    if (cachedDraft) {
      app.activateWalkDraft(walkId);
      this.currentWalkId = walkId;
    }

    try {
      const result = await getWalkDetail({ id: walkId });
      const walk = result && result.walk ? result.walk : null;
      if (!walk) {
        return;
      }
      if (walk.status === 'finished') {
        wx.showToast({ title: '这次漫步已经结束', icon: 'none' });
        setTimeout(() => {
          wx.redirectTo({ url: `/pages/walk-detail/walk-detail?id=${encodeURIComponent(walkId)}&source=history` });
        }, 300);
        return;
      }
      const remoteDraft = buildDraftFromWalk(walk);
      const nextDraft = cachedDraft
        ? syncDraftAggregates({
            ...remoteDraft,
            ...cachedDraft,
            walkId,
            status: walk.status || cachedDraft.status || 'active',
          })
        : remoteDraft;
      app.globalData.currentTheme = walk.themeSnapshot || app.globalData.currentTheme;
      app.setWalkDraft(nextDraft, walkId);
      this.currentWalkId = walkId;
    } catch (error) {
      wx.showToast({ title: '恢复进行中漫步失败', icon: 'none' });
    }
  },

  refreshState() {
    const theme = app.globalData.currentTheme;
    const draft = syncDraftAggregates(app.globalData.walkDraft);
    this.currentWalkId = draft.walkId || this.currentWalkId || '';
    const routeStats = mergeRouteStatsWithDraft(draft, this.data.isTracking);
    const themeKey = buildThemeKey(theme, draft);
    let nextDraft = draft;
    if (draft.sticker && draft.sticker.themeKey && draft.sticker.themeKey !== themeKey) {
      nextDraft = {
        ...draft,
        sticker: null,
      };
      this.setDraft(nextDraft);
    }
    this.setData({
      activeMission: nextDraft.selectedMission || this.data.activeMission || ((theme && theme.missions && theme.missions[0]) || SUMMARY_MISSION_KEY),
      theme,
      generatedMissionCardMap: this.generatedMissionCardMap || {},
      draft: {
        ...nextDraft,
        sticker: decorateSticker(nextDraft.sticker),
      },
      routeStats,
      mapPolyline: buildMapPolyline(nextDraft.routePoints),
    });
  },

  setDraft(nextDraft) {
    const walkId = this.currentWalkId || (nextDraft && nextDraft.walkId) || app.globalData.activeWalkId || '';
    app.setWalkDraft(syncDraftAggregates({
      ...(nextDraft || {}),
      walkId,
    }), walkId);
    this.refreshState();
  },

  getActiveMissionKey() {
    return this.data.activeMission || (this.data.theme && this.data.theme.missions && this.data.theme.missions[0]) || SUMMARY_MISSION_KEY;
  },

  getMissionAssets(mission, draft = this.data.draft) {
    const missionKey = mission || SUMMARY_MISSION_KEY;
    const missionAssetMap = ensureMissionAssetMap((draft && draft.missionAssetMap) || {});
    return missionAssetMap[missionKey] || createEmptyMissionAssets();
  },

  getMissionAssetsForVerify(mission) {
    const missionAssets = this.getMissionAssets(mission);
    const hasMissionMedia =
      (missionAssets.photoList && missionAssets.photoList.length) ||
      (missionAssets.videoList && missionAssets.videoList.length) ||
      (missionAssets.audioList && missionAssets.audioList.length);
    const hasMissionNote = missionAssets.noteText && missionAssets.noteText.trim();

    if (hasMissionMedia || hasMissionNote) {
      return missionAssets;
    }
    return createEmptyMissionAssets();
  },

  attachMissionAsset(draft, mission, field, asset) {
    const missionKey = mission || SUMMARY_MISSION_KEY;
    const missionAssetMap = ensureMissionAssetMap(draft.missionAssetMap || {});
    const missionAssets = {
      ...createEmptyMissionAssets(),
      ...(missionAssetMap[missionKey] || {}),
    };
    missionAssets[field] = [...(missionAssets[field] || []), asset];
    missionAssetMap[missionKey] = missionAssets;
    return {
      ...draft,
      missionAssetMap,
    };
  },

  updateMissionAssets(mission, patch) {
    const draft = { ...this.data.draft };
    const missionKey = mission || SUMMARY_MISSION_KEY;
    const missionAssetMap = ensureMissionAssetMap(draft.missionAssetMap || {});
    missionAssetMap[missionKey] = {
      ...createEmptyMissionAssets(),
      ...(missionAssetMap[missionKey] || {}),
      ...patch,
    };
    this.setDraft({
      ...draft,
      missionAssetMap,
    });
  },

  selectMission(event) {
    const mission = event.detail.mission;
    const draft = { ...this.data.draft, selectedMission: mission };
    this.setDraft(draft);
    this.setData({
      activeMission: mission,
      expandedMission: this.data.expandedMission === mission ? '' : mission,
    });
  },

  toggleMissionDone(event) {
    const mission = event.detail.mission;
    if (!mission || mission === SUMMARY_MISSION_KEY) {
      return;
    }
    const completed = new Set(this.data.draft.completedMissions || []);
    if (completed.has(mission)) {
      completed.delete(mission);
    } else {
      completed.add(mission);
    }
    const draft = { ...this.data.draft, completedMissions: Array.from(completed), selectedMission: mission };
    this.setDraft(draft);
  },

  async handleMissionVerify(event) {
    const mission = event.detail.mission || this.data.activeMission;
    const mode = event.detail.mode || '';
    if (mission) {
      const draft = { ...this.data.draft, selectedMission: mission };
      this.setDraft(draft);
      this.setData({ activeMission: mission });
    }
    if (mode === 'photo') {
      await this.choosePhoto(mission);
      return;
    }
    if (mode === 'video') {
      await this.chooseVideo(mission);
      return;
    }
    if (mode === 'audio') {
      this.toggleAudioRecording(mission);
      return;
    }
    if (mode === 'verify') {
      await this.verifyMissionForTask(mission);
      return;
    }
  },

  handleMissionNoteInput(event) {
    const mission = event.detail.mission;
    const noteText = event.detail.noteText;
    if (!mission) {
      return;
    }
    this.updateMissionAssets(mission, { noteText });
  },

  async ensureCompanionNote(mission, missionAssets, options = {}) {
    const forceRefresh = !!options.forceRefresh;
    const userNoteText = String((missionAssets && missionAssets.noteText) || '').trim();
    const photoList = Array.isArray(missionAssets && missionAssets.photoList) ? missionAssets.photoList.filter(Boolean) : [];
    if (!userNoteText && !photoList.length) {
      return '';
    }
    if (!forceRefresh && missionAssets && missionAssets.companionNote) {
      return missionAssets.companionNote;
    }

    const result = await generateCompanionNote({
      themeTitle: this.data.theme && this.data.theme.title ? this.data.theme.title : '',
      locationName: this.data.draft && this.data.draft.locationName ? this.data.draft.locationName : '',
      locationContext: this.data.draft && this.data.draft.locationContext ? this.data.draft.locationContext : '',
      mission,
      userNoteText,
      photoList,
      previousCompanionNote: missionAssets && missionAssets.companionNote ? missionAssets.companionNote : '',
      regenerationHint: forceRefresh ? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : '',
    });
    return String((result && result.companionNote) || '').trim();
  },

  async handleGenerateMissionCard(event) {
    const mission = event.detail.mission || this.data.activeMission;
    if (!mission) {
      wx.showToast({ title: '先选择一个任务', icon: 'none' });
      return;
    }

    const missionAssets = this.getMissionAssets(mission);
    const hasPhoto = missionAssets.photoList && missionAssets.photoList.length;
    const hasNote = missionAssets.noteText && missionAssets.noteText.trim();
    if (!hasPhoto && !hasNote) {
      wx.showToast({ title: '先上传图片或补一句文字', icon: 'none' });
      return;
    }

    this.setData({
      activeMission: mission,
      generatingMissionCard: mission,
      showMissionCardModal: true,
      missionCardModal: {
        mission,
        imageSrc: '',
        isGenerating: true,
      },
    });

    let nextMissionAssets = {
      ...createEmptyMissionAssets(),
      ...missionAssets,
    };
    const forceRefresh = !!(missionAssets && (missionAssets.cardImagePath || missionAssets.companionNote));
    try {
      const companionNote = await this.ensureCompanionNote(mission, nextMissionAssets, { forceRefresh });
      if (companionNote && companionNote !== nextMissionAssets.companionNote) {
        nextMissionAssets = {
          ...nextMissionAssets,
          companionNote,
          cardImagePath: '',
        };
        this.updateMissionAssets(mission, nextMissionAssets);
      } else if (forceRefresh) {
        nextMissionAssets = {
          ...nextMissionAssets,
          cardImagePath: '',
        };
        this.updateMissionAssets(mission, nextMissionAssets);
      }
    } catch (error) {
      wx.showToast({ title: '66 正在走神，先用现有记录制卡', icon: 'none' });
    }

    const nextMap = {
      ...(this.generatedMissionCardMap || {}),
      [mission]: ((this.generatedMissionCardMap && this.generatedMissionCardMap[mission]) || 0) + 1,
    };
    this.generatedMissionCardMap = nextMap;
    const renderVersion = nextMap[mission];
    this.setData({
      generatedMissionCardMap: nextMap,
      missionCardRenderPayload: {
        mission,
        assets: nextMissionAssets,
        renderVersion,
      },
    });
  },

  openEmbeddedMissionCard(event) {
    const mission = event.detail && event.detail.mission ? event.detail.mission : '';
    const src = event.detail && event.detail.src ? event.detail.src : '';
    if (!mission || !src) {
      return;
    }
    this.setData({
      showMissionCardModal: true,
      missionCardModal: {
        mission,
        imageSrc: src,
        isGenerating: false,
      },
    });
  },

  handleMissionCardGenerated(event) {
    const tempFilePath = event.detail && event.detail.tempFilePath ? event.detail.tempFilePath : '';
    const mission = event.detail && event.detail.mission ? event.detail.mission : this.data.missionCardModal.mission;
    if (!tempFilePath) {
      return;
    }
    if (
      this.data.missionCardModal
      && this.data.missionCardModal.imageSrc === tempFilePath
      && !this.data.missionCardModal.isGenerating
    ) {
      return;
    }
    this.updateMissionAssets(mission, {
      ...this.getMissionAssets(mission),
      cardImagePath: tempFilePath,
    });
    this.setData({
      generatingMissionCard: '',
      missionCardModal: {
        mission,
        imageSrc: tempFilePath,
        isGenerating: false,
      },
    });
  },

  closeMissionCardModal() {
    this.setData({
      showMissionCardModal: false,
      generatingMissionCard: '',
      missionCardModal: {
        mission: '',
        imageSrc: '',
        isGenerating: false,
      },
    });
  },

  async resolveMissionCardFilePath() {
    const src = this.data.missionCardModal && this.data.missionCardModal.imageSrc;
    if (!src) {
      throw new Error('missing_mission_card');
    }

    const normalizedSrc = String(src);
    if (normalizedSrc.startsWith('cloud://')) {
      const tempUrl = await resolveCloudFileUrl(normalizedSrc);
      if (!tempUrl) {
        throw new Error('missing_mission_card_url');
      }
      const download = await downloadFile(tempUrl);
      if (!download || !download.tempFilePath) {
        throw new Error('download_mission_card_failed');
      }
      return download.tempFilePath;
    }

    if (/^https?:\/\//i.test(normalizedSrc)) {
      const download = await downloadFile(normalizedSrc);
      if (!download || !download.tempFilePath) {
        throw new Error('download_mission_card_failed');
      }
      return download.tempFilePath;
    }

    return normalizedSrc;
  },

  async handleSaveMissionCardToAlbum() {
    const src = this.data.missionCardModal && this.data.missionCardModal.imageSrc;
    if (!src) {
      wx.showToast({ title: '还没有可保存的卡片', icon: 'none' });
      return;
    }
    try {
      await ensureAlbumPermission();
      const filePath = await this.resolveMissionCardFilePath();
      await saveImageToAlbum(filePath);
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (error) {
      wx.showModal({
        title: '保存卡片失败',
        content: explainAlbumSaveError(error),
        showCancel: false,
        confirmText: '知道了',
      });
    }
  },

  markMissionPassed(mission, review) {
    const completed = new Set(this.data.draft.completedMissions || []);
    completed.add(mission);
    const missionReviews = {
      ...(this.data.draft.missionReviews || {}),
      [mission]: review,
    };
    const draft = { ...this.data.draft, completedMissions: Array.from(completed), missionReviews, selectedMission: mission };
    this.setDraft(draft);
  },

  saveMissionReview(mission, review) {
    const missionReviews = {
      ...(this.data.draft.missionReviews || {}),
      [mission]: review,
    };
    const draft = { ...this.data.draft, missionReviews, selectedMission: mission };
    this.setDraft(draft);
  },

  handleNoteInput(event) {
    this.updateMissionAssets(SUMMARY_MISSION_KEY, {
      ...this.getMissionAssets(SUMMARY_MISSION_KEY),
      noteText: event.detail.value,
    });
  },

  async choosePhoto(mission = '') {
    try {
      const result = await chooseImage(9);
      const photoPaths = (result.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean);
      const targetMission = mission || this.getActiveMissionKey();
      let draft = { ...this.data.draft };
      photoPaths.forEach((path) => {
        draft = this.attachMissionAsset(draft, targetMission, 'photoList', path);
      });
      this.setDraft(draft);
    } catch (error) {
      if (error && error.errMsg && error.errMsg.includes('cancel')) {
        return;
      }
      wx.showToast({ title: '选择图片失败', icon: 'none' });
    }
  },

  async chooseVideo(mission = '') {
    try {
      const result = await chooseVideo(3);
      const selectedVideos = (result.tempFiles || []).map((item) => ({
        tempFilePath: item.tempFilePath,
        duration: item.duration || 0,
        size: item.size || 0,
      }));
      const targetMission = mission || this.getActiveMissionKey();
      let draft = { ...this.data.draft };
      selectedVideos.forEach((item) => {
        draft = this.attachMissionAsset(draft, targetMission, 'videoList', item);
      });
      this.setDraft(draft);
    } catch (error) {
      if (error && error.errMsg && error.errMsg.includes('cancel')) {
        return;
      }
      wx.showToast({ title: '选择视频失败', icon: 'none' });
    }
  },

  toggleAudioRecording(mission = '') {
    if (!recorderManager) {
      wx.showToast({ title: '当前环境不支持录音', icon: 'none' });
      return;
    }

    if (this.data.isRecordingAudio) {
      recorderManager.stop();
      return;
    }

    this.recordingMission = mission || this.getActiveMissionKey();
    recorderManager.start({
      duration: 60000,
      sampleRate: 44100,
      numberOfChannels: 1,
      encodeBitRate: 192000,
      format: 'mp3',
    });
    this.setData({ isRecordingAudio: true, recordingMission: this.recordingMission });
  },

  async verifyActiveMission() {
    const mission = this.data.activeMission;
    if (!mission) {
      wx.showToast({ title: '先选择一个任务', icon: 'none' });
      return;
    }

    const missionAssets = this.getMissionAssets(mission);
    if (!(missionAssets.photoList || []).length) {
      wx.showToast({ title: '请先上传图片再核验', icon: 'none' });
      return;
    }

    this.setData({ isVerifyingMission: true });
    try {
      const uploadedPhotos = await Promise.all((missionAssets.photoList || []).map((path) => this.uploadAsset(path, 'image')));
      const review = await verifyMission({
        mission,
        noteText: missionAssets.noteText || '',
        fileIDs: uploadedPhotos,
      });
      const nextReview = {
        passed: !!review.passed,
        comment: review.comment,
        confidence: review.confidence || 'medium',
        reviewedAt: review.reviewedAt || Date.now(),
        photoList: uploadedPhotos,
      };
      if (review.passed) {
        this.markMissionPassed(mission, nextReview);
      } else {
        this.saveMissionReview(mission, nextReview);
      }
      wx.showToast({ title: review.passed ? '核验通过' : '已给出建议', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: '核验失败', icon: 'none' });
    } finally {
      this.setData({ isVerifyingMission: false });
    }
  },

  async verifyMissionForTask(mission) {
    if (!mission) {
      wx.showToast({ title: '先选择一个任务', icon: 'none' });
      return;
    }

    const missionAssets = this.getMissionAssetsForVerify(mission);
    const hasMedia =
      (missionAssets.photoList && missionAssets.photoList.length) ||
      (missionAssets.videoList && missionAssets.videoList.length) ||
      (missionAssets.audioList && missionAssets.audioList.length);
    const missionNoteText = missionAssets.noteText || '';

    if (!hasMedia && !missionNoteText.trim()) {
      wx.showToast({ title: '先补一点素材或文字', icon: 'none' });
      return;
    }

    const clearedReviews = { ...(this.data.draft.missionReviews || {}) };
    delete clearedReviews[mission];
    this.setDraft({
      ...this.data.draft,
      missionReviews: clearedReviews,
      selectedMission: mission,
    });
    this.setData({ isVerifyingMission: true });
    try {
      const uploadedImages = await Promise.all((missionAssets.photoList || []).map((path) => this.uploadAsset(path, 'image')));
      const uploadedVideos = await Promise.all((missionAssets.videoList || []).map((item) => this.uploadAsset(item.tempFilePath || item, 'video')));
      const uploadedAudios = await Promise.all((missionAssets.audioList || []).map((item) => this.uploadAsset(item.tempFilePath || item, 'audio')));
      const review = await verifyMission({
        missionId: `mission-${((this.data.theme && this.data.theme.missions) || []).indexOf(mission) + 1}`,
        mission,
        missionNoteText,
        overallNoteText: this.data.draft.noteText,
        imageFileIDs: uploadedImages,
        videoFileIDs: uploadedVideos,
        audioFileIDs: uploadedAudios,
      });
      const nextReview = {
        passed: !!review.passed,
        score: Number(review.score || 0),
        version: review.version || '',
        comment: review.comment,
        confidence: review.confidence || 'medium',
        evidence: Array.isArray(review.evidence) ? review.evidence : [],
        reviewedAt: review.reviewedAt || Date.now(),
        mediaSummary: review.mediaSummary || {
          imageCount: uploadedImages.length,
          videoCount: uploadedVideos.length,
          audioCount: uploadedAudios.length,
        },
      };
      if (review.passed) {
        this.markMissionPassed(mission, nextReview);
      } else {
        this.saveMissionReview(mission, nextReview);
      }
      this.updateMissionAssets(mission, {
        ...missionAssets,
        photoList: uploadedImages,
        videoList: uploadedVideos,
        audioList: uploadedAudios,
      });
      wx.showToast({ title: `已评分 ${nextReview.score} 分`, icon: 'none' });
    } catch (error) {
      wx.showToast({ title: '核验失败', icon: 'none' });
    } finally {
      this.setData({ isVerifyingMission: false });
    }
  },

  removeMissionPhoto(event) {
    const mission = event.detail.mission || event.currentTarget.dataset.mission;
    const index = Number(event.detail.index !== undefined ? event.detail.index : event.currentTarget.dataset.index);
    const assets = this.getMissionAssets(mission);
    const photoList = [...(assets.photoList || [])];
    photoList.splice(index, 1);
    this.updateMissionAssets(mission, {
      ...assets,
      photoList,
    });
  },

  removeMissionVideo(event) {
    const mission = event.detail.mission || event.currentTarget.dataset.mission;
    const index = Number(event.detail.index !== undefined ? event.detail.index : event.currentTarget.dataset.index);
    const assets = this.getMissionAssets(mission);
    const videoList = [...(assets.videoList || [])];
    videoList.splice(index, 1);
    this.updateMissionAssets(mission, {
      ...assets,
      videoList,
    });
  },

  removeMissionAudio(event) {
    const mission = event.detail.mission || event.currentTarget.dataset.mission;
    const index = Number(event.detail.index !== undefined ? event.detail.index : event.currentTarget.dataset.index);
    const assets = this.getMissionAssets(mission);
    const audioList = [...(assets.audioList || [])];
    audioList.splice(index, 1);
    this.updateMissionAssets(mission, {
      ...assets,
      audioList,
    });
  },

  async toggleTracking() {
    if (this.data.isTracking) {
      this.stopTracking();
      return;
    }

    const now = Date.now();
    const draft = {
      ...this.data.draft,
      trackStartedAt: this.data.draft.trackStartedAt || now,
      trackStoppedAt: null,
    };
    this.setDraft(draft);
    this.setData({
      isTracking: true,
      isMapOpen: true,
      draft,
      routeStats: mergeRouteStatsWithDraft(draft, true),
      mapPolyline: buildMapPolyline(draft.routePoints),
    });
    try {
      const mode = await this.startRealtimeTracking();
      this.trackingMode = mode;
      wx.showToast({ title: mode === 'background' ? '后台定位已开启' : '前台实时定位已开启', icon: 'none' });
    } catch (error) {
      try {
        await this.startPollingTracking();
        this.trackingMode = 'polling';
        const reason = this.lastTrackingFailureReason || '持续定位未成功开启';
        wx.showModal({
          title: '已切换为间隔记录',
          content: reason,
          showCancel: false,
          confirmText: '知道了',
        });
      } catch (fallbackError) {
        this.setData({ isTracking: false });
        wx.showToast({ title: explainLocationError(fallbackError, '轨迹记录'), icon: 'none' });
      }
    }
  },

  stopTracking() {
    if (!this.data.isTracking) {
      return;
    }
    if (routeTimer) {
      clearInterval(routeTimer);
      routeTimer = null;
    }
    if (wx.offLocationChange && this.handleRealtimeLocationChange) {
      wx.offLocationChange(this.handleRealtimeLocationChange);
    }
    if (wx.stopLocationUpdate) {
      wx.stopLocationUpdate({});
    }
    this.trackingMode = '';
    const stoppedAt = Date.now();
    const draft = {
      ...app.globalData.walkDraft,
      trackStoppedAt: stoppedAt,
    };
    this.setDraft(draft);
    this.setData({
      isTracking: false,
      draft,
      routeStats: mergeRouteStatsWithDraft(draft, false),
      mapPolyline: buildMapPolyline(draft.routePoints),
    });
  },

  startRealtimeTracking() {
    if (!wx.onLocationChange || (!wx.startLocationUpdate && !wx.startLocationUpdateBackground)) {
      this.lastTrackingFailureReason = '当前环境不支持持续定位';
      return Promise.reject(new Error('location_update_not_supported'));
    }

    return getCurrentLocation().then((initialLocation) => new Promise((resolve, reject) => {
      const bindRealtimeListener = (mode) => {
        this.trackingMode = mode;
        if (wx.offLocationChange && this.handleRealtimeLocationChange) {
          wx.offLocationChange(this.handleRealtimeLocationChange);
        }
        wx.onLocationChange(this.handleRealtimeLocationChange);
        this.appendTrackPoint(initialLocation);
        resolve(mode);
      };

      const startForeground = () => {
        if (!wx.startLocationUpdate) {
          this.lastTrackingFailureReason = '前台实时定位不可用';
          reject(new Error('location_update_not_supported'));
          return;
        }
        wx.startLocationUpdate({
          success: () => bindRealtimeListener('foreground'),
          fail: (error) => {
            this.lastTrackingFailureReason = `前台失败 ${((error && error.errMsg) || '').replace(/^.*fail:?/, '').trim() || '未知原因'}`;
            reject(error);
          },
        });
      };

      if (!wx.startLocationUpdateBackground) {
        startForeground();
        return;
      }

      wx.startLocationUpdateBackground({
        success: () => {
          bindRealtimeListener('background');
        },
        fail: (error) => {
          this.lastTrackingFailureReason = `后台失败 ${((error && error.errMsg) || '').replace(/^.*fail:?/, '').trim() || '未知原因'}`;
          startForeground();
        },
      });
    }));
  },

  startPollingTracking() {
    return getCurrentLocation().then((initialLocation) => {
      this.appendTrackPoint(initialLocation);
      routeTimer = setInterval(() => {
        getCurrentLocation()
          .then((location) => this.appendTrackPoint(location))
          .catch(() => {
            this.stopTracking();
            wx.showToast({ title: '轨迹记录失败', icon: 'none' });
          });
      }, TRACK_SAMPLE_INTERVAL_MS);
    });
  },

  appendTrackPoint(location) {
    try {
      const now = Date.now();
      const nextPoint = {
        latitude: location.latitude,
        longitude: location.longitude,
        timestamp: now,
        accuracy: location.accuracy,
      };
      const routePoints = [...(app.globalData.walkDraft.routePoints || [])];
      const nextRoutePoints = [...routePoints, nextPoint];
      const routeStats = buildRouteStats(
        nextRoutePoints,
        app.globalData.walkDraft.trackStartedAt || app.globalData.walkDraft.startedAt || now,
        app.globalData.walkDraft.trackStoppedAt,
        true
      );
      const draft = {
        ...app.globalData.walkDraft,
        latitude: location.latitude,
        longitude: location.longitude,
        routePoints: nextRoutePoints,
        routeStats: {
          durationMs: routeStats.durationMs,
          pointCount: routeStats.pointCount,
          distanceMeters: routeStats.distanceMeters,
        },
      };
      this.setDraft(draft);
      return true;
    } catch (error) {
      this.stopTracking();
      wx.showToast({ title: '轨迹记录失败', icon: 'none' });
      return false;
    }
  },

  async handleSave() {
    if (!this.data.theme) {
      wx.showToast({ title: '缺少主题信息', icon: 'none' });
      return;
    }

    await app.ensureUserReady();
    if (!app.globalData.user) {
      const pausedLogin = isManualLogoutSuppressed();
      wx.showModal({
        title: pausedLogin ? '先恢复登录' : '先完善资料',
        content: pausedLogin
          ? '你刚刚主动退出过账号，去个人页点一次登录后，就能继续把这次漫步保存到你的个人历史。'
          : '第一次保存漫步前，需要先在个人页设置一次头像和昵称。之后会自动识别当前微信账户。',
        confirmText: pausedLogin ? '去恢复' : '去设置',
        success: (res) => {
          if (res.confirm) {
            wx.switchTab({ url: '/pages/profile/profile' });
          }
        },
      });
      return;
    }

    this.setData({ isSaving: true });
    try {
      const summaryAssets = this.getMissionAssets(SUMMARY_MISSION_KEY);
      const uploadCache = {};
      const uploadCached = (filePath, kind) => {
        const key = `${kind}:${filePath}`;
        if (!uploadCache[key]) {
          uploadCache[key] = this.uploadAsset(filePath, kind);
        }
        return uploadCache[key];
      };
      const uploadedPhotos = await Promise.all((summaryAssets.photoList || []).map((path) => uploadCached(path, 'image')));
      const uploadedVideos = await Promise.all((summaryAssets.videoList || []).map((item) => uploadCached(item.tempFilePath || item, 'video')));
      const uploadedAudios = await Promise.all((summaryAssets.audioList || []).map((item) => uploadCached(item.tempFilePath || item, 'audio')));
      const missionAssetEntries = Object.entries(this.data.draft.missionAssetMap || {});
      const uploadedMissionAssetEntries = await Promise.all(missionAssetEntries.map(async ([mission, assets]) => ([
        mission,
        {
          noteText: assets.noteText || '',
          companionNote: assets.companionNote || '',
          photoList: await Promise.all((assets.photoList || []).map((path) => uploadCached(path, 'image'))),
          videoList: await Promise.all((assets.videoList || []).map((item) => uploadCached(item.tempFilePath || item, 'video'))),
          audioList: await Promise.all((assets.audioList || []).map((item) => uploadCached(item.tempFilePath || item, 'audio'))),
          cardImagePath: assets.cardImagePath ? await uploadCached(assets.cardImagePath, 'image') : '',
        },
      ])));
      const missionAssetMap = Object.fromEntries(uploadedMissionAssetEntries);
      const routeStats = buildRouteStats(
        this.data.draft.routePoints,
        this.data.draft.trackStartedAt || this.data.draft.startedAt,
        this.data.draft.trackStoppedAt || Date.now(),
        false
      );
      const walkId = this.currentWalkId || this.data.draft.walkId || '';
      const endedAt = this.data.draft.trackStoppedAt || Date.now();
      const result = await createWalk({
        id: walkId,
        themeSnapshot: this.data.theme,
        themeTitle: this.data.theme.title,
        locationName: this.data.draft.locationName,
        locationContext: this.data.draft.locationContext,
        locationAddress: this.data.draft.locationAddress,
        latitude: this.data.draft.latitude,
        longitude: this.data.draft.longitude,
        routePoints: this.data.draft.routePoints,
        missionsCompleted: this.data.draft.completedMissions,
        missionReviews: this.data.draft.missionReviews,
        photoList: uploadedPhotos,
        videoList: uploadedVideos,
        audioList: uploadedAudios,
        missionAssetMap,
        noteText: summaryAssets.noteText || '',
        isPublic: false,
        walkMode: this.data.draft.walkMode,
        generationSource: this.data.draft.generationSource,
        season: this.data.draft.season || '',
        generationContext: this.data.draft.generationContext || {},
        trackStartedAt: this.data.draft.trackStartedAt || this.data.draft.startedAt,
        trackStoppedAt: endedAt,
        startedAt: this.data.draft.startedAt,
        endedAt,
        routeStats: {
          durationMs: routeStats.durationMs,
          pointCount: routeStats.pointCount,
          distanceMeters: routeStats.distanceMeters,
        },
        sticker: this.data.draft.sticker || null,
        status: 'finished',
      });
      this.stopTracking();
      app.clearWalkDraft(walkId);
      app.globalData.currentTheme = null;
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/history/history' });
      }, 500);
      return result;
    } catch (error) {
      wx.showToast({
        title: `保存失败${error && error.message ? `：${error.message}` : ''}`.slice(0, 20),
        icon: 'none',
        duration: 3000,
      });
    } finally {
      this.setData({ isSaving: false });
      this.refreshState();
    }
  },

  uploadAsset(filePath, kind) {
    if (!filePath || String(filePath).startsWith('cloud://') || String(filePath).startsWith('http')) {
      return Promise.resolve(filePath);
    }
    return requestUpload(filePath, { kind });
  },

  openStickerModal() {
    if (!(this.data.draft && this.data.draft.sticker)) {
      return;
    }
    this.setData({ showStickerModal: true });
  },

  closeStickerModal() {
    this.setData({ showStickerModal: false });
  },

  resolveStickerUrl() {
    const sticker = this.data.draft && this.data.draft.sticker;
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

  handleShareStickerFromRecord() {
    wx.showToast({ title: '先保存漫步，再去详情页分享', icon: 'none' });
  },

  async handleGenerateSticker() {
    if (!this.data.theme) {
      wx.showToast({ title: '先生成漫步主题', icon: 'none' });
      return;
    }

    this.setData({ isGeneratingSticker: true });
    try {
      const planResult = await generateStickerPlan({
        themeTitle: this.data.theme.title,
        themeDescription: this.data.theme.description,
        themeCategory: this.data.theme.category,
        walkMode: this.data.draft.walkMode,
        locationName: this.data.draft.locationName,
        locationContext: this.data.draft.locationContext,
        overallNoteText: this.data.draft.noteText,
        missions: this.data.theme.missions || [],
        completedMissions: this.data.draft.completedMissions || [],
      });
      const stickerPlan = planResult && planResult.sticker ? planResult.sticker : null;
      if (!stickerPlan) {
        wx.showToast({ title: '贴纸文案生成失败', icon: 'none' });
        return;
      }
      const themedStickerPlan = {
        ...stickerPlan,
        themeKey: buildThemeKey(this.data.theme, this.data.draft),
      };
      this.setDraft({
        ...this.data.draft,
        sticker: decorateSticker(themedStickerPlan),
      });
      const result = await generateStickerImage({
        sticker: themedStickerPlan,
        themeTitle: this.data.theme.title,
      });
      const sticker = result && result.sticker ? result.sticker : null;
      if (!sticker) {
        wx.showToast({ title: '贴纸生成失败', icon: 'none' });
        return;
      }
      this.setDraft({
        ...this.data.draft,
        sticker: decorateSticker({
          ...sticker,
          themeKey: buildThemeKey(this.data.theme, this.data.draft),
        }),
      });
      wx.showToast({ title: '贴纸图片已生成', icon: 'success' });
    } catch (error) {
      wx.showModal({
        title: '贴纸生成失败',
        content: (error && error.message) || '未知错误',
        showCancel: false,
        confirmText: '知道了',
      });
    } finally {
      this.setData({ isGeneratingSticker: false });
    }
  },

  noop() {},
});

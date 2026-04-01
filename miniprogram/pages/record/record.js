const app = getApp();
const { createWalk } = require('../../services/walk');
const { requestUpload } = require('../../services/api');
const { getCurrentLocation } = require('../../utils/location');
const { chooseImage, chooseVideo } = require('../../utils/media');
const { verifyMission } = require('../../services/theme');
const { generateStickerPlan, generateStickerImage } = require('../../services/sticker');

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
  },

  onLoad() {
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
        app.setWalkDraft(syncDraftAggregates(draft));
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

  refreshState() {
    const theme = app.globalData.currentTheme;
    const draft = syncDraftAggregates(app.globalData.walkDraft);
    const routeStats = buildRouteStats(
      draft.routePoints,
      draft.trackStartedAt || draft.startedAt,
      draft.trackStoppedAt,
      this.data.isTracking
    );
    const themeKey = buildThemeKey(theme, draft);
    let nextDraft = draft;
    if (draft.sticker && draft.sticker.themeKey && draft.sticker.themeKey !== themeKey) {
      nextDraft = {
        ...draft,
        sticker: null,
      };
      app.setWalkDraft(nextDraft);
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
    });
  },

  setDraft(nextDraft) {
    app.setWalkDraft(syncDraftAggregates(nextDraft));
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

  handleGenerateMissionCard(event) {
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

    const nextMap = {
      ...(this.generatedMissionCardMap || {}),
      [mission]: ((this.generatedMissionCardMap && this.generatedMissionCardMap[mission]) || 0) + 1,
    };
    this.generatedMissionCardMap = nextMap;
    const renderVersion = nextMap[mission];
    this.setData({
      activeMission: mission,
      generatedMissionCardMap: nextMap,
      showMissionCardModal: true,
      missionCardModal: {
        mission,
        imageSrc: '',
        isGenerating: true,
      },
      missionCardRenderPayload: {
        mission,
        assets: missionAssets,
        renderVersion,
      },
    });
  },

  handleMissionCardGenerated(event) {
    const tempFilePath = event.detail && event.detail.tempFilePath ? event.detail.tempFilePath : '';
    const mission = event.detail && event.detail.mission ? event.detail.mission : this.data.missionCardModal.mission;
    if (!tempFilePath) {
      return;
    }
    this.updateMissionAssets(mission, {
      ...this.getMissionAssets(mission),
      cardImagePath: tempFilePath,
    });
    this.setData({
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
      missionCardModal: {
        mission: '',
        imageSrc: '',
        isGenerating: false,
      },
    });
  },

  async handleSaveMissionCardToAlbum() {
    const filePath = this.data.missionCardModal && this.data.missionCardModal.imageSrc;
    if (!filePath) {
      wx.showToast({ title: '还没有可保存的卡片', icon: 'none' });
      return;
    }
    try {
      await saveImageToAlbum(filePath);
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
    app.setWalkDraft(draft);
    this.setData({
      isTracking: true,
      isMapOpen: true,
      draft,
      routeStats: buildRouteStats(
        draft.routePoints,
        draft.trackStartedAt || draft.startedAt,
        draft.trackStoppedAt,
        true
      ),
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
    app.setWalkDraft(draft);
    this.setData({
      isTracking: false,
      draft,
      routeStats: buildRouteStats(
        draft.routePoints,
        draft.trackStartedAt || draft.startedAt,
        stoppedAt,
        false
      ),
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
      wx.showModal({
        title: '需要先登录',
        content: '登录当前微信账户后，才能保存这次漫步记录到个人历史。',
        confirmText: '去登录',
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
      const result = await createWalk({
        themeSnapshot: this.data.theme,
        themeTitle: this.data.theme.title,
        locationName: this.data.draft.locationName,
        locationContext: this.data.draft.locationContext,
        locationAddress: this.data.draft.locationAddress,
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
        trackStartedAt: this.data.draft.trackStartedAt || this.data.draft.startedAt,
        trackStoppedAt: this.data.draft.trackStoppedAt || Date.now(),
        routeStats: {
          durationMs: routeStats.durationMs,
          pointCount: routeStats.pointCount,
          distanceMeters: routeStats.distanceMeters,
        },
        sticker: this.data.draft.sticker || null,
      });
      this.stopTracking();
      app.clearWalkDraft();
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

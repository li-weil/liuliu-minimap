const app = getApp();
const { createWalk, getWalkDetail } = require('../../services/walk');
const { requestUpload } = require('../../services/api');
const { explainLocationError, getCurrentLocation } = require('../../utils/location');
const { normalizeRecordedDuration } = require('../../utils/audio');
const { chooseImage, chooseVideo } = require('../../utils/media');
const { generateCompanionNote } = require('../../services/companion');
const { isManualLogoutSuppressed } = require('../../services/user');
const {
  createDefaultPrivacyPopup,
  ensurePrivacyAuthorization,
  openPrivacyContract,
  rejectPrivacyAuthorization,
  resolvePrivacyAuthorization,
} = require('../../utils/privacy');

let recorderManager = null;
let routeTimer = null;
let walkStatusPollingTimer = null;
let walkStatusPollingInFlight = false;

const TRACK_SAMPLE_INTERVAL_MS = 5000;
const SUMMARY_MISSION_KEY = '__summary__';
const SUMMARY_MISSION_LABEL = '总结与补充';
const MAX_IMAGE_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_SIZE_BYTES = 30 * 1024 * 1024;
const MAX_AUDIO_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const LARGE_VIDEO_WARNING_SIZE_BYTES = 15 * 1024 * 1024;
const UPLOAD_RETRY_LIMIT = 1;

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

function hasMissionContent(assets) {
  const safeAssets = assets || {};
  const noteText = String(safeAssets.noteText || '').trim();
  const photoCount = Array.isArray(safeAssets.photoList) ? safeAssets.photoList.filter(Boolean).length : 0;
  const videoCount = Array.isArray(safeAssets.videoList) ? safeAssets.videoList.filter(Boolean).length : 0;
  const audioCount = Array.isArray(safeAssets.audioList) ? safeAssets.audioList.filter(Boolean).length : 0;
  return !!noteText || photoCount > 0 || videoCount > 0 || audioCount > 0;
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

function getCompletedMissionList(source) {
  const completedSource = Array.isArray(source && source.completedMissions)
    ? source.completedMissions
    : Array.isArray(source && source.missionsCompleted)
      ? source.missionsCompleted
      : [];
  return completedSource.map(normalizeMissionKey).filter(Boolean);
}

function hasMissionCheckIn(source, mission) {
  if (!mission) {
    return false;
  }
  const review = source && source.missionReviews ? source.missionReviews[mission] : null;
  if (review && review.status === 'needs_recheck') {
    return false;
  }
  const completedSet = new Set(getCompletedMissionList(source));
  if (completedSet.has(mission)) {
    return true;
  }
  if (!review) {
    return false;
  }
  return review.status === 'checked_in' || !!review.checkedInAt || review.passed === true;
}

function hasMissionRecheckRequired(source, mission) {
  const review = source && source.missionReviews ? source.missionReviews[mission] : null;
  return !!(review && review.status === 'needs_recheck');
}

function deriveCompletedMissions(missions, draft) {
  const completedSet = new Set(getCompletedMissionList(draft));
  (missions || []).forEach((mission) => {
    if (hasMissionCheckIn(draft, mission)) {
      completedSet.add(mission);
    }
  });
  return Array.from(completedSet).filter(Boolean);
}

function markMissionNeedsRecheck(draft, mission) {
  const missionKey = mission || SUMMARY_MISSION_KEY;
  const completedMissions = getCompletedMissionList(draft).filter((item) => item !== missionKey);
  const currentReview = draft && draft.missionReviews ? draft.missionReviews[missionKey] : null;
  return {
    ...draft,
    completedMissions,
    missionReviews: {
      ...((draft && draft.missionReviews) || {}),
      [missionKey]: {
        ...(currentReview || {}),
        status: 'needs_recheck',
        invalidatedAt: Date.now(),
        previousCheckedInAt: currentReview && currentReview.checkedInAt ? currentReview.checkedInAt : null,
      },
    },
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

function findUnconfirmedMissionContent(missions, draft) {
  const missionAssetMap = ensureMissionAssetMap((draft && draft.missionAssetMap) || {});
  return (missions || []).filter((mission) => {
    const assets = missionAssetMap[mission] || createEmptyMissionAssets();
    return hasMissionContent(assets) && !hasMissionCheckIn(draft, mission);
  });
}

function buildDraftFromWalk(walk) {
  if (!walk) {
    return null;
  }
  return syncDraftAggregates({
    walkId: walk.id || walk._id || '',
    status: walk.status || 'active',
    locationName: walk.locationName || '当前位置',
    locationAddress: walk.locationAddress || '',
    latitude: walk.latitude || null,
    longitude: walk.longitude || null,
    routePoints: Array.isArray(walk.routePoints) ? walk.routePoints : [],
    completedMissions: getCompletedMissionList(walk),
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
    walkMode: walk.walkMode || 'pure',
    generationSource: walk.generationSource || 'preset',
    season: walk.season || '',
    generationContext: walk.generationContext || {},
  });
}

function explainMediaSelectionError(error, mediaType) {
  const rawErrMsg = String((error && error.errMsg) || (error && error.message) || '').trim();
  const errMsg = rawErrMsg.toLowerCase();
  if (!errMsg) {
    return `${mediaType}选择失败`;
  }
  if (errMsg.includes('cancel')) {
    return '';
  }
  if (errMsg.includes('auth deny') || errMsg.includes('permission')) {
    return mediaType === '图片' ? '请在系统设置里允许访问相册或相机' : '请在系统设置里允许访问相机和相册';
  }
  if (errMsg.includes('camera')) {
    return '相机暂时不可用，请检查系统权限';
  }
  return `${mediaType}选择失败：${rawErrMsg}`;
}

function explainRecorderError(error) {
  const rawErrMsg = String((error && error.errMsg) || (error && error.message) || '').trim();
  const errMsg = rawErrMsg.toLowerCase();
  if (!errMsg) {
    return '录音启动失败';
  }
  if (errMsg.includes('auth deny') || errMsg.includes('permission') || errMsg.includes('record')) {
    return '请在系统设置里允许麦克风权限';
  }
  return `录音失败：${rawErrMsg}`;
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)}KB`;
  }
  return `${size}B`;
}

function getUploadSizeLimit(kind) {
  if (kind === 'video') {
    return MAX_VIDEO_UPLOAD_SIZE_BYTES;
  }
  if (kind === 'audio') {
    return MAX_AUDIO_UPLOAD_SIZE_BYTES;
  }
  return MAX_IMAGE_UPLOAD_SIZE_BYTES;
}

function getUploadKindLabel(kind) {
  if (kind === 'video') {
    return '视频';
  }
  if (kind === 'audio') {
    return '录音';
  }
  return '图片';
}

function buildUploadKey(kind, filePath) {
  return `${kind}:${filePath}`;
}

function extractUploadPath(item) {
  if (!item) {
    return '';
  }
  if (typeof item === 'string') {
    return item;
  }
  return item.tempFilePath || item.path || '';
}

function getKnownUploadSize(item) {
  if (!item || typeof item === 'string') {
    return 0;
  }
  return Number(item.size || 0);
}

function isRemoteAsset(filePath) {
  return !filePath || String(filePath).startsWith('cloud://') || String(filePath).startsWith('http');
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

function buildRecordShareTitle(data = {}) {
  const user = app.globalData.user || null;
  if (user && user.nickName) {
    return `遛遛 | ${user.nickName} 邀你一起 citywalk`;
  }

  return '遛遛 | 邀你一起 citywalk';
}

function buildMissionProgress(theme, draft) {
  const missions = Array.isArray(theme && theme.missions) ? theme.missions : [];
  const completedCount = missions.filter((mission) => hasMissionCheckIn(draft, mission)).length;
  const totalCount = missions.length;
  return {
    completedCount,
    totalCount,
    percent: totalCount ? Math.round((completedCount / totalCount) * 100) : 0,
  };
}

Page({
  data: {
    activeMission: '',
    summaryMissionKey: SUMMARY_MISSION_KEY,
    theme: null,
    draft: null,
    isTracking: false,
    isSaving: false,
    isMapOpen: false,
    isRecordingAudio: false,
    recordingMission: '',
    expandedMission: '',
    checkingInMission: '',
    routeStats: {
      durationMs: 0,
      pointCount: 0,
      distanceMeters: 0,
      durationLabel: '0秒',
      distanceLabel: '0 m',
      startedLabel: '未开始',
      stoppedLabel: '未开始',
    },
    missionCompletedCount: 0,
    missionTotalCount: 0,
    missionProgressPercent: 0,
    saveStatusText: '',
    uploadProgressPercent: 0,
    uploadProgressCurrent: 0,
    uploadProgressTotal: 0,
    pendingCompanionMissionMap: {},
    privacyPopup: createDefaultPrivacyPopup(),
    isLeavingForHistory: false,
  },

  async onLoad(query) {
    this.currentWalkId = query && (query.id || query.walkId) ? (query.id || query.walkId) : '';
    if (wx.getRecorderManager) {
      recorderManager = wx.getRecorderManager();
      recorderManager.onStop((result) => {
        const nextAudio = {
          tempFilePath: result.tempFilePath,
          duration: normalizeRecordedDuration(result.duration),
        };
        const mission = this.recordingMission || this.getActiveMissionKey();
        let draft = { ...app.globalData.walkDraft };
        draft = this.attachMissionAsset(draft, mission, 'audioList', nextAudio);
        this.setDraft(draft);
        this.setData({ isRecordingAudio: false, recordingMission: '' });
        this.recordingMission = '';
        this.refreshState();
      });
      recorderManager.onError((error) => {
        this.setData({ isRecordingAudio: false, recordingMission: '' });
        this.recordingMission = '';
        wx.showModal({
          title: '录音失败',
          content: explainRecorderError(error),
          showCancel: false,
          confirmText: '知道了',
        });
      });
    }
    this.handleRealtimeLocationChange = (location) => {
      this.appendTrackPoint(location);
    };
    this.trackingMode = '';
    this.recordingMission = '';
    this.isPageUnloaded = false;
    if (this.currentWalkId) {
      await this.restoreWalkContext(this.currentWalkId);
    }
  },

  onShow() {
    this.refreshState();
    this.startWalkStatusPolling();
  },

  onUnload() {
    this.isPageUnloaded = true;
    this.stopWalkStatusPolling();
    this.stopTracking();
    if (this.data.isRecordingAudio && recorderManager) {
      recorderManager.stop();
    }
  },

  onHide() {
    this.stopWalkStatusPolling();
  },

  onShareAppMessage() {
    return {
      title: buildRecordShareTitle(this.data),
      path: '/pages/index/index',
    };
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
      app.globalData.currentTheme = walk.themeSnapshot || app.globalData.currentTheme;

      if (cachedDraft) {
        app.setWalkDraft(syncDraftAggregates({
          ...cachedDraft,
          walkId,
          status: 'active',
        }), walkId);
        this.currentWalkId = walkId;
        return;
      }

      const remoteDraft = buildDraftFromWalk(walk);
      app.setWalkDraft(remoteDraft, walkId);
      this.currentWalkId = walkId;
    } catch (error) {
      wx.showToast({ title: '恢复进行中漫步失败', icon: 'none' });
    }
  },

  startWalkStatusPolling() {
    this.stopWalkStatusPolling();
    if (!this.currentWalkId) {
      return;
    }
    walkStatusPollingTimer = setInterval(() => {
      if (walkStatusPollingInFlight || this.data.isSaving || this.data.isLeavingForHistory || !this.currentWalkId) {
        return;
      }
      this.syncRemoteWalkStatus();
    }, 4000);
  },

  stopWalkStatusPolling() {
    if (walkStatusPollingTimer) {
      clearInterval(walkStatusPollingTimer);
      walkStatusPollingTimer = null;
    }
  },

  leaveRecordForHistory(message = '这次漫步已在另一端结束，已返回纪念卡册') {
    if (this.data.isLeavingForHistory) {
      return;
    }
    this.stopWalkStatusPolling();
    this.stopTracking();
    this.setData({ isLeavingForHistory: true });
    wx.showToast({
      title: message,
      icon: 'none',
      duration: 1800,
    });
    setTimeout(() => {
      if (this.isPageUnloaded) {
        return;
      }
      wx.switchTab({ url: '/pages/history/history' });
    }, 300);
  },

  async syncRemoteWalkStatus() {
    if (!this.currentWalkId || this.data.isLeavingForHistory) {
      return;
    }
    walkStatusPollingInFlight = true;
    try {
      const result = await getWalkDetail({ id: this.currentWalkId });
      const walk = result && result.walk ? result.walk : null;
      if (!walk) {
        return;
      }
      if (walk.status === 'finished') {
        this.leaveRecordForHistory();
      }
    } catch (error) {
      // Ignore polling failures to avoid interrupting local recording.
    } finally {
      walkStatusPollingInFlight = false;
    }
  },

  refreshState() {
    const theme = app.globalData.currentTheme;
    const draft = syncDraftAggregates(app.globalData.walkDraft);
    this.currentWalkId = draft.walkId || this.currentWalkId || '';
    const routeStats = mergeRouteStatsWithDraft(draft, this.data.isTracking);
    const nextDraft = draft;
    const missionProgress = buildMissionProgress(theme, nextDraft);
    this.setData({
      activeMission: nextDraft.selectedMission || this.data.activeMission || ((theme && theme.missions && theme.missions[0]) || SUMMARY_MISSION_KEY),
      theme,
      draft: {
        ...nextDraft,
      },
      routeStats,
      missionCompletedCount: missionProgress.completedCount,
      missionTotalCount: missionProgress.totalCount,
      missionProgressPercent: missionProgress.percent,
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

  attachMissionAsset(draft, mission, field, asset) {
    const missionKey = mission || SUMMARY_MISSION_KEY;
    const missionAssetMap = ensureMissionAssetMap(draft.missionAssetMap || {});
    const missionAssets = {
      ...createEmptyMissionAssets(),
      ...(missionAssetMap[missionKey] || {}),
    };
    missionAssets[field] = [...(missionAssets[field] || []), asset];
    missionAssets.companionNote = '';
    missionAssets.cardImagePath = '';
    missionAssetMap[missionKey] = missionAssets;
    if (hasMissionCheckIn(draft, missionKey)) {
      return {
        ...markMissionNeedsRecheck(draft, missionKey),
        missionAssetMap,
      };
    }
    const completedMissions = getCompletedMissionList(draft);
    const missionReviews = { ...(draft.missionReviews || {}) };
    return {
      ...draft,
      missionAssetMap,
      completedMissions: completedMissions.filter((item) => item !== missionKey),
      missionReviews: Object.fromEntries(Object.entries(missionReviews).filter(([key]) => key !== missionKey)),
    };
  },

  updateMissionAssets(mission, patch, options = {}) {
    const draft = { ...this.data.draft };
    const missionKey = mission || SUMMARY_MISSION_KEY;
    const missionAssetMap = ensureMissionAssetMap(draft.missionAssetMap || {});
    const nextMissionAssets = {
      ...createEmptyMissionAssets(),
      ...(missionAssetMap[missionKey] || {}),
      ...patch,
    };
    const patchKeys = Object.keys(patch || {});
    const touchesGeneratedAssets = patchKeys.includes('companionNote') || patchKeys.includes('cardImagePath');
    const preserveCheckIn = !!options.preserveCheckIn;
    const shouldRequireRecheck = !preserveCheckIn && hasMissionCheckIn(draft, missionKey);
    const preserveGeneratedAssets = !!options.preserveGeneratedAssets || !!options.preserveCheckIn || touchesGeneratedAssets;
    if (!preserveGeneratedAssets) {
      nextMissionAssets.companionNote = '';
      nextMissionAssets.cardImagePath = '';
    }
    missionAssetMap[missionKey] = nextMissionAssets;
    const missionReviews = { ...(draft.missionReviews || {}) };
    const completedMissions = getCompletedMissionList(draft);
    const nextDraft = {
      ...draft,
      missionAssetMap,
    };
    if (shouldRequireRecheck) {
      const recheckDraft = markMissionNeedsRecheck(nextDraft, missionKey);
      nextDraft.completedMissions = recheckDraft.completedMissions;
      nextDraft.missionReviews = recheckDraft.missionReviews;
    } else if (!preserveCheckIn && !hasMissionRecheckRequired(draft, missionKey)) {
      delete missionReviews[missionKey];
      nextDraft.missionReviews = missionReviews;
      nextDraft.completedMissions = completedMissions.filter((item) => item !== missionKey);
    }
    this.setDraft({
      ...nextDraft,
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

  async handleMissionMediaCapture(event) {
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
    const allowEmptyMaterial = !!options.allowEmptyMaterial;
    const userNoteText = String((missionAssets && missionAssets.noteText) || '').trim();
    const photoList = Array.isArray(missionAssets && missionAssets.photoList) ? missionAssets.photoList.filter(Boolean) : [];
    if (!allowEmptyMaterial && !userNoteText && !photoList.length) {
      return '';
    }
    if (!forceRefresh && missionAssets && missionAssets.companionNote) {
      return missionAssets.companionNote;
    }

    const result = await generateCompanionNote({
      themeTitle: this.data.theme && this.data.theme.title ? this.data.theme.title : '',
      locationName: this.data.draft && this.data.draft.locationName ? this.data.draft.locationName : '',
      mission,
      userNoteText,
      photoList,
      previousCompanionNote: missionAssets && missionAssets.companionNote ? missionAssets.companionNote : '',
      regenerationHint: forceRefresh ? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : '',
    });
    return String((result && result.companionNote) || '').trim();
  },

  async handleMissionCheckIn(event) {
    const mission = event.detail.mission || this.data.activeMission;
    if (!mission) {
      return;
    }
    if (hasMissionCheckIn(this.data.draft, mission)) {
      return;
    }

    const missionAssets = {
      ...createEmptyMissionAssets(),
      ...this.getMissionAssets(mission),
    };
    const checkedInAt = Date.now();
    this.markMissionPassed(mission, {
      status: 'checked_in',
      checkedInAt,
      companionNoteStatus: 'pending',
    });
    this.setData({ activeMission: mission, checkingInMission: '' });
    this.setMissionCompanionPending(mission, true);
    wx.showToast({ title: '已打卡', icon: 'success' });
    this.generateMissionCompanionNoteInBackground(mission, checkedInAt, missionAssets);
  },

  markMissionPassed(mission, review) {
    const completed = new Set(getCompletedMissionList(this.data.draft));
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

  setMissionCompanionPending(mission, pending) {
    if (!mission) {
      return;
    }
    const nextMap = {
      ...(this.data.pendingCompanionMissionMap || {}),
    };
    if (pending) {
      nextMap[mission] = true;
    } else {
      delete nextMap[mission];
    }
    this.setData({
      pendingCompanionMissionMap: nextMap,
      checkingInMission: '',
    });
  },

  async waitForPendingCompanionNotes() {
    const taskMap = this.pendingCompanionTasks || {};
    const tasks = Object.values(taskMap).filter((task) => task && typeof task.then === 'function');
    if (!tasks.length) {
      return;
    }
    this.updateSaveProgress('正在整理任务文案...', 0, 0, 0);
    await Promise.allSettled(tasks);
  },

  isMissionCheckInCurrent(mission, checkedInAt) {
    const review = this.data.draft && this.data.draft.missionReviews ? this.data.draft.missionReviews[mission] : null;
    return hasMissionCheckIn(this.data.draft, mission) && review && Number(review.checkedInAt || 0) === Number(checkedInAt || 0);
  },

  generateMissionCompanionNoteInBackground(mission, checkedInAt, snapshotAssets) {
    if (!this.pendingCompanionTasks) {
      this.pendingCompanionTasks = {};
    }
    const task = (async () => {
      try {
      const companionNote = await this.ensureCompanionNote(mission, snapshotAssets, {
        allowEmptyMaterial: true,
      });
      if (!this.isMissionCheckInCurrent(mission, checkedInAt)) {
        return;
      }
      if (companionNote) {
        const latestMissionAssets = this.getMissionAssets(mission);
        this.updateMissionAssets(mission, {
          ...latestMissionAssets,
          companionNote,
          cardImagePath: '',
        }, { preserveCheckIn: true });
      }
      const currentReview = (this.data.draft && this.data.draft.missionReviews && this.data.draft.missionReviews[mission]) || {};
      this.saveMissionReview(mission, {
        ...currentReview,
        status: 'checked_in',
        checkedInAt,
        companionNoteStatus: companionNote ? 'ready' : 'empty',
      });
      } catch (error) {
      if (!this.isMissionCheckInCurrent(mission, checkedInAt)) {
        return;
      }
      const currentReview = (this.data.draft && this.data.draft.missionReviews && this.data.draft.missionReviews[mission]) || {};
      this.saveMissionReview(mission, {
        ...currentReview,
        status: 'checked_in',
        checkedInAt,
        companionNoteStatus: 'failed',
      });
      } finally {
      if (this.isMissionCheckInCurrent(mission, checkedInAt)) {
        this.setMissionCompanionPending(mission, false);
      }
        if (this.pendingCompanionTasks && this.pendingCompanionTasks[mission] === task) {
          delete this.pendingCompanionTasks[mission];
        }
      }
    })();
    this.pendingCompanionTasks[mission] = task;
    return task;
  },

  handleNoteInput(event) {
    this.updateMissionAssets(SUMMARY_MISSION_KEY, {
      ...this.getMissionAssets(SUMMARY_MISSION_KEY),
      noteText: event.detail.value,
    });
  },

  async choosePhoto(mission = '') {
    try {
      await ensurePrivacyAuthorization(this, {
        title: '上传图片前说明',
        content: '选择图片仅用于当前任务打卡和漫步记录保存，不会在你未操作时自动读取相册。',
      });
      const result = await chooseImage(9);
      const photoPaths = (result.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean);
      const targetMission = mission || this.getActiveMissionKey();
      let draft = { ...this.data.draft };
      photoPaths.forEach((path) => {
        draft = this.attachMissionAsset(draft, targetMission, 'photoList', path);
      });
      this.setDraft(draft);
    } catch (error) {
      if (error && error.message === 'privacy_authorization_denied') {
        wx.showToast({ title: '未同意隐私说明，暂时无法选图', icon: 'none' });
        return;
      }
      const message = explainMediaSelectionError(error, '图片');
      if (!message) {
        return;
      }
      wx.showModal({
        title: '图片选择失败',
        content: message,
        showCancel: false,
        confirmText: '知道了',
      });
    }
  },

  async chooseVideo(mission = '') {
    try {
      await ensurePrivacyAuthorization(this, {
        title: '上传视频前说明',
        content: '选择或拍摄视频仅用于当前任务打卡和漫步记录保存，不会在你未操作时自动启用。',
      });
      const result = await chooseVideo(3);
      const selectedVideos = (result.tempFiles || []).map((item) => ({
        tempFilePath: item.tempFilePath,
        duration: item.duration || 0,
        size: item.size || 0,
      }));
      const oversizedVideo = selectedVideos.find((item) => Number(item.size || 0) > MAX_VIDEO_UPLOAD_SIZE_BYTES);
      if (oversizedVideo) {
        wx.showModal({
          title: '视频过大',
          content: `当前限制为 ${formatFileSize(MAX_VIDEO_UPLOAD_SIZE_BYTES)}，你选择的视频约 ${formatFileSize(oversizedVideo.size)}，请压缩后再上传。`,
          showCancel: false,
          confirmText: '知道了',
        });
        return;
      }
      const largeVideo = selectedVideos.find((item) => Number(item.size || 0) > LARGE_VIDEO_WARNING_SIZE_BYTES);
      if (largeVideo) {
        wx.showModal({
          title: '视频较大',
          content: `这个视频约 ${formatFileSize(largeVideo.size)}，弱网下上传会更久。建议尽量裁短或压缩后再保存。`,
          showCancel: false,
          confirmText: '继续',
        });
      }
      const targetMission = mission || this.getActiveMissionKey();
      let draft = { ...this.data.draft };
      selectedVideos.forEach((item) => {
        draft = this.attachMissionAsset(draft, targetMission, 'videoList', item);
      });
      this.setDraft(draft);
    } catch (error) {
      if (error && error.message === 'privacy_authorization_denied') {
        wx.showToast({ title: '未同意隐私说明，暂时无法选视频', icon: 'none' });
        return;
      }
      const message = explainMediaSelectionError(error, '视频');
      if (!message) {
        return;
      }
      wx.showModal({
        title: '视频选择失败',
        content: message,
        showCancel: false,
        confirmText: '知道了',
      });
    }
  },

  async toggleAudioRecording(mission = '') {
    if (!recorderManager) {
      wx.showToast({ title: '当前环境不支持录音', icon: 'none' });
      return;
    }

    if (this.data.isRecordingAudio) {
      recorderManager.stop();
      return;
    }

    try {
      await ensurePrivacyAuthorization(this, {
        title: '录音前说明',
        content: '录音仅在你主动点击后开始，用于当前任务打卡补充，不会在后台自动录制。',
      });
      this.recordingMission = mission || this.getActiveMissionKey();
      recorderManager.start({
        duration: 60000,
        sampleRate: 44100,
        numberOfChannels: 1,
        encodeBitRate: 192000,
        format: 'mp3',
      });
      this.setData({ isRecordingAudio: true, recordingMission: this.recordingMission });
    } catch (error) {
      if (error && error.message === 'privacy_authorization_denied') {
        wx.showToast({ title: '未同意隐私说明，暂时无法录音', icon: 'none' });
        return;
      }
      wx.showModal({
        title: '录音失败',
        content: explainRecorderError(error),
        showCancel: false,
        confirmText: '知道了',
      });
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

    try {
      await ensurePrivacyAuthorization(this, {
        title: '开启定位前说明',
        content: '当前位置显示会在你停留当前页面时使用前台定位，仅用于在记录页展示当前位置，不涉及后台持续定位。',
      });
    } catch (error) {
      if (error && error.message === 'privacy_authorization_denied') {
        wx.showToast({ title: '未同意隐私说明，暂时无法显示位置', icon: 'none' });
        return;
      }
      wx.showToast({ title: '暂时无法开启位置显示', icon: 'none' });
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
    });
    try {
      const mode = await this.startRealtimeTracking();
      this.trackingMode = mode;
      wx.showToast({ title: '前台定位已开启，请尽量保持当前页', icon: 'none' });
    } catch (error) {
      try {
        await this.startPollingTracking();
        this.trackingMode = 'polling';
        const reason = this.lastTrackingFailureReason || '前台定位未成功开启';
        wx.showModal({
          title: '已切换为间隔定位',
          content: `${reason}。当前会改为间隔刷新当前位置，离开前台或定位受限时，位置更新可能变慢。`,
          showCancel: false,
          confirmText: '知道了',
        });
      } catch (fallbackError) {
        this.setData({ isTracking: false });
        wx.showToast({ title: explainLocationError(fallbackError, '位置显示'), icon: 'none' });
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
    });
  },

  startRealtimeTracking() {
    if (!wx.onLocationChange || !wx.startLocationUpdate) {
      this.lastTrackingFailureReason = '当前环境不支持前台定位更新';
      return Promise.reject(new Error('location_update_not_supported'));
    }

    return getCurrentLocation().then((initialLocation) => new Promise((resolve, reject) => {
      const bindRealtimeListener = () => {
        this.trackingMode = 'foreground';
        if (wx.offLocationChange && this.handleRealtimeLocationChange) {
          wx.offLocationChange(this.handleRealtimeLocationChange);
        }
        wx.onLocationChange(this.handleRealtimeLocationChange);
        this.appendTrackPoint(initialLocation);
        resolve('foreground');
      };

      wx.startLocationUpdate({
        success: () => {
          bindRealtimeListener();
        },
        fail: (error) => {
          this.lastTrackingFailureReason = `前台失败 ${((error && error.errMsg) || '').replace(/^.*fail:?/, '').trim() || '未知原因'}`;
          reject(error);
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
            wx.showToast({ title: '位置显示失败', icon: 'none' });
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
      wx.showToast({ title: '位置显示失败', icon: 'none' });
      return false;
    }
  },

  async handleSave() {
    if (!this.data.theme) {
      wx.showToast({ title: '缺少主题信息', icon: 'none' });
      return;
    }
    const checkableMissions = [
      ...(Array.isArray(this.data.theme.missions) ? this.data.theme.missions : []),
      SUMMARY_MISSION_KEY,
    ];
    const recheckMissions = checkableMissions.filter((mission) => hasMissionRecheckRequired(this.data.draft, mission));
    if (recheckMissions.length) {
      wx.showModal({
        title: '需要重新打卡',
        content: `有 ${recheckMissions.length} 个已打卡任务的内容发生了变动。请重新打卡后再结束漫步。`,
        showCancel: false,
        confirmText: '知道了',
      });
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
            app.setPendingNavigation({
              url: `/pages/record/record?id=${encodeURIComponent(this.currentWalkId || (this.data.draft && this.data.draft.walkId) || '')}`,
              mode: 'navigateTo',
            });
            wx.switchTab({ url: '/pages/profile/profile' });
          }
        },
      });
      return;
    }

    this.setData({ isSaving: true });
    try {
      if (this.data.isTracking) {
        this.stopTracking();
      }
      await this.waitForPendingCompanionNotes();
      const saveDraft = {
        ...syncDraftAggregates(app.globalData.walkDraft),
      };
      const unconfirmedContentMissions = findUnconfirmedMissionContent(checkableMissions, saveDraft);
      if (unconfirmedContentMissions.length) {
        wx.showModal({
          title: '请先完成打卡',
          content: `有 ${unconfirmedContentMissions.length} 个任务已经记录了内容。请点任务里的“完成这一站”后，再结束漫步。`,
          showCancel: false,
          confirmText: '知道了',
        });
        return null;
      }
      saveDraft.completedMissions = deriveCompletedMissions(checkableMissions, saveDraft);
      const recheckBeforeUpload = checkableMissions.filter((mission) => hasMissionRecheckRequired(saveDraft, mission));
      if (recheckBeforeUpload.length) {
        wx.showModal({
          title: '需要重新打卡',
          content: `有 ${recheckBeforeUpload.length} 个已打卡任务的内容发生了变动。请重新打卡后再结束漫步。`,
          showCancel: false,
          confirmText: '知道了',
        });
        return null;
      }
      this.setDraft(saveDraft);
      const summaryAssets = this.getMissionAssets(SUMMARY_MISSION_KEY, saveDraft);
      const uploadJobs = await this.collectUploadJobs(saveDraft);
      const invalidFile = await this.validateUploadJobs(uploadJobs);
      if (invalidFile) {
        throw new Error(`${invalidFile.label}超过${formatFileSize(invalidFile.limit)}`);
      }
      const uploadResultMap = await this.uploadJobsSequentially(uploadJobs);
      const resolveUploadedAsset = (item, kind) => {
        const filePath = extractUploadPath(item);
        if (!filePath) {
          return item;
        }
        if (isRemoteAsset(filePath)) {
          return filePath;
        }
        return uploadResultMap[buildUploadKey(kind, filePath)] || filePath;
      };
      const uploadedPhotos = (summaryAssets.photoList || []).map((path) => resolveUploadedAsset(path, 'image'));
      const uploadedVideos = (summaryAssets.videoList || []).map((item) => resolveUploadedAsset(item, 'video'));
      const uploadedAudios = (summaryAssets.audioList || []).map((item) => resolveUploadedAsset(item, 'audio'));
      const missionAssetEntries = Object.entries(saveDraft.missionAssetMap || {});
      const uploadedMissionAssetEntries = await Promise.all(missionAssetEntries.map(async ([mission, assets]) => ([
        mission,
        {
          noteText: assets.noteText || '',
          companionNote: assets.companionNote || '',
          photoList: (assets.photoList || []).map((path) => resolveUploadedAsset(path, 'image')),
          videoList: (assets.videoList || []).map((item) => resolveUploadedAsset(item, 'video')),
          audioList: (assets.audioList || []).map((item) => resolveUploadedAsset(item, 'audio')),
          cardImagePath: assets.cardImagePath ? resolveUploadedAsset(assets.cardImagePath, 'image') : '',
        },
      ])));
      const missionAssetMap = Object.fromEntries(uploadedMissionAssetEntries);
      const routeStats = buildRouteStats(
        saveDraft.routePoints,
        saveDraft.trackStartedAt || saveDraft.startedAt,
        saveDraft.trackStoppedAt || Date.now(),
        false
      );
      const walkId = this.currentWalkId || saveDraft.walkId || '';
      const endedAt = saveDraft.trackStoppedAt || Date.now();
      const result = await createWalk({
        id: walkId,
        themeSnapshot: this.data.theme,
        themeTitle: this.data.theme.title,
        locationName: saveDraft.locationName,
        locationAddress: saveDraft.locationAddress,
        latitude: saveDraft.latitude,
        longitude: saveDraft.longitude,
        routePoints: saveDraft.routePoints,
        missionsCompleted: saveDraft.completedMissions,
        missionReviews: saveDraft.missionReviews,
        photoList: uploadedPhotos,
        videoList: uploadedVideos,
        audioList: uploadedAudios,
        missionAssetMap,
        noteText: summaryAssets.noteText || '',
        isPublic: false,
        walkMode: saveDraft.walkMode,
        generationSource: saveDraft.generationSource,
        season: saveDraft.season || '',
        generationContext: saveDraft.generationContext || {},
        trackStartedAt: saveDraft.trackStartedAt || saveDraft.startedAt,
        trackStoppedAt: endedAt,
        startedAt: saveDraft.startedAt,
        endedAt,
        routeStats: {
          durationMs: routeStats.durationMs,
          pointCount: routeStats.pointCount,
          distanceMeters: routeStats.distanceMeters,
        },
        status: 'finished',
      });
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
      wx.hideLoading();
      this.setData({
        isSaving: false,
        saveStatusText: '',
        uploadProgressPercent: 0,
        uploadProgressCurrent: 0,
        uploadProgressTotal: 0,
      });
      this.refreshState();
    }
  },

  async collectUploadJobs(saveDraft) {
    const jobs = [];
    const seen = new Set();
    const pushJob = (item, kind) => {
      const filePath = extractUploadPath(item);
      if (!filePath || isRemoteAsset(filePath)) {
        return;
      }
      const key = buildUploadKey(kind, filePath);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      jobs.push({
        key,
        kind,
        filePath,
        size: getKnownUploadSize(item),
        label: getUploadKindLabel(kind),
      });
    };

    const summaryAssets = this.getMissionAssets(SUMMARY_MISSION_KEY, saveDraft);
    (summaryAssets.photoList || []).forEach((item) => pushJob(item, 'image'));
    (summaryAssets.videoList || []).forEach((item) => pushJob(item, 'video'));
    (summaryAssets.audioList || []).forEach((item) => pushJob(item, 'audio'));
    Object.values(saveDraft.missionAssetMap || {}).forEach((assets) => {
      ((assets && assets.photoList) || []).forEach((item) => pushJob(item, 'image'));
      ((assets && assets.videoList) || []).forEach((item) => pushJob(item, 'video'));
      ((assets && assets.audioList) || []).forEach((item) => pushJob(item, 'audio'));
      if (assets && assets.cardImagePath) {
        pushJob(assets.cardImagePath, 'image');
      }
    });
    return jobs;
  },

  async validateUploadJobs(uploadJobs = []) {
    for (let index = 0; index < uploadJobs.length; index += 1) {
      const job = uploadJobs[index];
      const size = job.size || await this.resolveLocalFileSize(job.filePath);
      const limit = getUploadSizeLimit(job.kind);
      if (size > limit) {
        return {
          ...job,
          size,
          limit,
        };
      }
    }
    return null;
  },

  async resolveLocalFileSize(filePath) {
    if (!filePath || isRemoteAsset(filePath)) {
      return 0;
    }
    try {
      const info = await getFileInfo(filePath);
      return Number(info.size || 0);
    } catch (error) {
      return 0;
    }
  },

  updateSaveProgress(text, current, total, percent) {
    const safePercent = Math.max(0, Math.min(100, Math.round(percent || 0)));
    const nextText = text || '正在保存这次漫步...';
    this.setData({
      saveStatusText: nextText,
      uploadProgressCurrent: current || 0,
      uploadProgressTotal: total || 0,
      uploadProgressPercent: safePercent,
    });
    wx.showLoading({
      title: safePercent > 0 ? `${Math.min(safePercent, 99)}%` : '保存中',
      mask: true,
    });
  },

  async uploadJobsSequentially(uploadJobs = []) {
    const total = uploadJobs.length;
    const uploadResultMap = {};
    if (!total) {
      this.updateSaveProgress('正在整理漫步记录...', 0, 0, 100);
      return uploadResultMap;
    }

    for (let index = 0; index < uploadJobs.length; index += 1) {
      const job = uploadJobs[index];
      const current = index + 1;
      this.updateSaveProgress(`正在上传${job.label} ${current}/${total}`, current, total, ((current - 1) / total) * 100);
      const result = await this.uploadAssetWithRetry(job, current, total);
      uploadResultMap[job.key] = result;
    }
    this.updateSaveProgress('正在保存漫步记录...', total, total, 100);
    return uploadResultMap;
  },

  async uploadAssetWithRetry(job, current, total) {
    let lastError = null;
    for (let attempt = 0; attempt <= UPLOAD_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.uploadAsset(job.filePath, job.kind, {
          onProgress: (progressEvent) => {
            const percent = Number(progressEvent && progressEvent.progress ? progressEvent.progress : 0);
            const overallPercent = total
              ? (((current - 1) + (percent / 100)) / total) * 100
              : percent;
            this.updateSaveProgress(
              `正在上传${job.label} ${current}/${total}（${Math.round(percent)}%）`,
              current,
              total,
              overallPercent
            );
          },
        });
      } catch (error) {
        lastError = error;
        if (attempt >= UPLOAD_RETRY_LIMIT) {
          break;
        }
        this.updateSaveProgress(`正在重试${job.label} ${current}/${total}`, current, total, ((current - 1) / total) * 100);
      }
    }
    throw lastError || new Error(`${job.label}上传失败`);
  },

  uploadAsset(filePath, kind, options = {}) {
    if (isRemoteAsset(filePath)) {
      return Promise.resolve(filePath);
    }
    return requestUpload(filePath, { kind }, options);
  },

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

  noop() {},
});

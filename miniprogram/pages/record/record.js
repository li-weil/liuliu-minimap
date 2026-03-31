const app = getApp();
const { createWalk } = require('../../services/walk');
const { requestUpload } = require('../../services/api');
const { getCurrentLocation } = require('../../utils/location');
const { chooseImage, chooseVideo } = require('../../utils/media');
const { verifyMission } = require('../../services/theme');

let recorderManager = null;
let routeTimer = null;

const TRACK_SAMPLE_INTERVAL_MS = 5000;

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

Page({
  data: {
    activeMission: '',
    isVerifyingMission: false,
    theme: null,
    draft: null,
    isTracking: false,
    isSaving: false,
    isMapOpen: false,
    isRecordingAudio: false,
    expandedMission: '',
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
        const audioList = [...((this.data.draft && this.data.draft.audioList) || [])];
        audioList.push({
          tempFilePath: result.tempFilePath,
          duration: result.duration || 0,
        });
        const draft = { ...app.globalData.walkDraft, audioList };
        app.setWalkDraft(draft);
        this.setData({ isRecordingAudio: false });
        this.refreshState();
      });
      recorderManager.onError(() => {
        this.setData({ isRecordingAudio: false });
        wx.showToast({ title: '录音失败', icon: 'none' });
      });
    }
    this.handleRealtimeLocationChange = (location) => {
      this.appendTrackPoint(location);
    };
    this.trackingMode = '';
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
    const draft = app.globalData.walkDraft;
    const routeStats = buildRouteStats(
      draft.routePoints,
      draft.trackStartedAt || draft.startedAt,
      draft.trackStoppedAt,
      this.data.isTracking
    );
    this.setData({
      activeMission: draft.selectedMission || this.data.activeMission || ((theme && theme.missions && theme.missions[0]) || ''),
      theme,
      draft,
      routeStats,
    });
  },

  setDraft(nextDraft) {
    app.setWalkDraft(nextDraft);
    this.refreshState();
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
      await this.choosePhoto();
      return;
    }
    if (mode === 'video') {
      await this.chooseVideo();
      return;
    }
    if (mode === 'audio') {
      this.toggleAudioRecording();
      return;
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
    const draft = { ...this.data.draft, noteText: event.detail.value };
    this.setDraft(draft);
  },

  async choosePhoto() {
    try {
      const result = await chooseImage(9);
      const photoPaths = (result.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean);
      const draft = { ...this.data.draft, photoList: [...(this.data.draft.photoList || []), ...photoPaths] };
      this.setDraft(draft);
    } catch (error) {
      if (error && error.errMsg && error.errMsg.includes('cancel')) {
        return;
      }
      wx.showToast({ title: '选择图片失败', icon: 'none' });
    }
  },

  async chooseVideo() {
    try {
      const result = await chooseVideo(3);
      const videoList = [...(this.data.draft.videoList || []), ...(result.tempFiles || []).map((item) => ({
        tempFilePath: item.tempFilePath,
        duration: item.duration || 0,
        size: item.size || 0,
      }))];
      this.setDraft({ ...this.data.draft, videoList });
    } catch (error) {
      if (error && error.errMsg && error.errMsg.includes('cancel')) {
        return;
      }
      wx.showToast({ title: '选择视频失败', icon: 'none' });
    }
  },

  toggleAudioRecording() {
    if (!recorderManager) {
      wx.showToast({ title: '当前环境不支持录音', icon: 'none' });
      return;
    }

    if (this.data.isRecordingAudio) {
      recorderManager.stop();
      return;
    }

    recorderManager.start({
      duration: 60000,
      sampleRate: 44100,
      numberOfChannels: 1,
      encodeBitRate: 192000,
      format: 'mp3',
    });
    this.setData({ isRecordingAudio: true });
  },

  async verifyActiveMission() {
    const mission = this.data.activeMission;
    if (!mission) {
      wx.showToast({ title: '先选择一个任务', icon: 'none' });
      return;
    }

    if (!(this.data.draft.photoList || []).length) {
      wx.showToast({ title: '请先上传图片再核验', icon: 'none' });
      return;
    }

    this.setData({ isVerifyingMission: true });
    try {
      const uploadedPhotos = await Promise.all((this.data.draft.photoList || []).map((path) => this.uploadAsset(path, 'image')));
      const review = await verifyMission({
        mission,
        noteText: this.data.draft.noteText,
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

  removePhoto(event) {
    const index = Number(event.currentTarget.dataset.index);
    const photoList = [...(this.data.draft.photoList || [])];
    photoList.splice(index, 1);
    this.setDraft({ ...this.data.draft, photoList });
  },

  removeVideo(event) {
    const index = Number(event.currentTarget.dataset.index);
    const videoList = [...(this.data.draft.videoList || [])];
    videoList.splice(index, 1);
    this.setDraft({ ...this.data.draft, videoList });
  },

  removeAudio(event) {
    const index = Number(event.currentTarget.dataset.index);
    const audioList = [...(this.data.draft.audioList || [])];
    audioList.splice(index, 1);
    this.setDraft({ ...this.data.draft, audioList });
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

    this.setData({ isSaving: true });
    try {
      const uploadedPhotos = await Promise.all((this.data.draft.photoList || []).map((path) => this.uploadAsset(path, 'image')));
      const uploadedVideos = await Promise.all((this.data.draft.videoList || []).map((item) => this.uploadAsset(item.tempFilePath, 'video')));
      const uploadedAudios = await Promise.all((this.data.draft.audioList || []).map((item) => this.uploadAsset(item.tempFilePath, 'audio')));
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
        noteText: this.data.draft.noteText,
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

  noop() {},
});

const app = getApp();
const { requestUpload } = require('../../services/api');
const { generateCompanionNote } = require('../../services/sticker');
const { finishTeamWalk, getTeamRoomDetail, submitTeamContribution, updateTeamMemberDraftState } = require('../../services/team');
const { chooseImage, chooseVideo } = require('../../utils/media');
const {
  createDefaultPrivacyPopup,
  ensurePrivacyAuthorization,
  openPrivacyContract,
  rejectPrivacyAuthorization,
  resolvePrivacyAuthorization,
} = require('../../utils/privacy');

let recorderManager = null;
let roomPollingTimer = null;
let roomPollingInFlight = false;
const MAX_IMAGE_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_SIZE_BYTES = 30 * 1024 * 1024;
const MAX_AUDIO_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const LARGE_VIDEO_WARNING_SIZE_BYTES = 15 * 1024 * 1024;
const UPLOAD_RETRY_LIMIT = 1;

function createEmptyDraft() {
  return {
    noteText: '',
    photoList: [],
    videoList: [],
    audioList: [],
    companionNote: '',
    completed: false,
  };
}

function cloneDraft(draft) {
  return {
    noteText: String((draft && draft.noteText) || ''),
    photoList: Array.isArray(draft && draft.photoList) ? [...draft.photoList] : [],
    videoList: Array.isArray(draft && draft.videoList) ? [...draft.videoList] : [],
    audioList: Array.isArray(draft && draft.audioList) ? [...draft.audioList] : [],
    companionNote: String((draft && draft.companionNote) || ''),
    completed: !!(draft && draft.completed),
  };
}

function hasDraftContent(draft) {
  const safeDraft = draft || {};
  const noteText = String(safeDraft.noteText || '').trim();
  const photoCount = Array.isArray(safeDraft.photoList) ? safeDraft.photoList.filter(Boolean).length : 0;
  const videoCount = Array.isArray(safeDraft.videoList) ? safeDraft.videoList.filter(Boolean).length : 0;
  const audioCount = Array.isArray(safeDraft.audioList) ? safeDraft.audioList.filter(Boolean).length : 0;
  return !!noteText || photoCount > 0 || videoCount > 0 || audioCount > 0;
}

function resetDraftCheckIn(draft) {
  return {
    ...cloneDraft(draft),
    companionNote: '',
    completed: false,
  };
}

function buildPendingMemberNotice(members = [], currentUserId = '') {
  const pendingMembers = (Array.isArray(members) ? members : []).filter((item) => {
    if (!item || item.userId === currentUserId) {
      return false;
    }
    return Array.isArray(item.pendingMissionKeys) && item.pendingMissionKeys.filter(Boolean).length > 0;
  });
  if (!pendingMembers.length) {
    return '';
  }
  const visibleNames = pendingMembers.map((item) => item.nickName || '队友').filter(Boolean);
  const preview = visibleNames.slice(0, 3).join('、');
  return pendingMembers.length > 3
    ? `${preview} 等 ${pendingMembers.length} 位成员还有内容未同步`
    : `${preview} 还有内容未同步`;
}

function buildDraftFromContribution(contribution) {
  if (!contribution) {
    return createEmptyDraft();
  }
  return {
    noteText: contribution.noteText || '',
    photoList: [...(contribution.photoList || [])],
    videoList: [...(contribution.videoList || [])],
    audioList: [...(contribution.audioList || [])],
    companionNote: contribution.companionNote || '',
    completed: !!contribution.completed,
  };
}

function groupMissionViews(room) {
  const missions = Array.isArray(room && room.themeSnapshot && room.themeSnapshot.missions)
    ? room.themeSnapshot.missions
    : [];
  const contributions = Array.isArray(room && room.contributions) ? room.contributions : [];
  return missions.map((mission) => {
    const missionContributions = contributions.filter((item) => item.missionKey === mission);
    const teamCompleted = missionContributions.some((item) => item.completed);
    return {
      mission,
      teamCompletedLabel: teamCompleted ? '团队已完成' : '待点亮',
      memberCount: Array.from(new Set(missionContributions.map((item) => item.userId))).length,
      tabClassName: '',
    };
  });
}

function withMissionSelection(missionViews, activeMission) {
  return (missionViews || []).map((item) => ({
    ...item,
    tabClassName: activeMission === item.mission ? 'mission-tab-active' : '',
  }));
}

function explainSubmitFailure(error) {
  const message = String((error && error.message) || (error && error.errMsg) || '').toLowerCase();
  if (message.includes('nickname_risky')) {
    return '昵称未通过安全校验，请先修改资料';
  }
  if (message.includes('note_text_risky')) {
    return '文字内容可能不适宜展示，请调整后再提交';
  }
  if (message.includes('permission_denied')) {
    return '你暂时没有这个房间的提交权限';
  }
  return '提交失败，请稍后重试';
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

function formatFileSize(size) {
  const numericSize = Number(size || 0);
  if (numericSize >= 1024 * 1024) {
    return `${(numericSize / (1024 * 1024)).toFixed(1)}MB`;
  }
  if (numericSize >= 1024) {
    return `${Math.round(numericSize / 1024)}KB`;
  }
  return `${numericSize}B`;
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
  return item.tempFilePath || item.filePath || item.url || '';
}

function getKnownUploadSize(item) {
  if (!item || typeof item === 'string') {
    return 0;
  }
  return Number(item.size || 0);
}

function isRemoteAsset(filePath) {
  const normalizedPath = String(filePath || '');
  return normalizedPath.startsWith('cloud://') || normalizedPath.startsWith('http://') || normalizedPath.startsWith('https://');
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

Page({
  data: {
    loading: true,
    saving: false,
    saveStatusText: '',
    uploadProgressPercent: 0,
    uploadProgressCurrent: 0,
    uploadProgressTotal: 0,
    isRecordingAudio: false,
    roomId: '',
    room: null,
    activeMission: '',
    missionViews: [],
    editorDraft: createEmptyDraft(),
    roomMemberCountLabel: '0 人同行',
    roomMissionProgressLabel: '0 / 0 个任务已点亮',
    audioButtonLabel: '录音',
    completedClassName: '',
    isLeavingForHistory: false,
    privacyPopup: createDefaultPrivacyPopup(),
  },

  onLoad(query) {
    this.missionDraftCache = {};
    this.missionDraftDirtyMap = {};
    this.draftStateReportTimers = {};
    this.recordingMission = '';
    this.isPageUnloaded = false;
    this.setData({ roomId: query.roomId || query.id || '' });
    if (wx.getRecorderManager) {
      recorderManager = wx.getRecorderManager();
      recorderManager.onStop((result) => {
        const mission = this.recordingMission || this.data.activeMission;
        this.recordingMission = '';
        if (mission) {
          this.updateMissionDraft(mission, (draft) => resetDraftCheckIn({
            ...draft,
            audioList: [...(draft.audioList || []), { tempFilePath: result.tempFilePath, duration: result.duration || 0 }],
          }));
        }
        if (!this.isPageUnloaded) {
          this.setData({
            isRecordingAudio: false,
            audioButtonLabel: '录音',
          });
        }
      });
      recorderManager.onError((error) => {
        this.recordingMission = '';
        if (!this.isPageUnloaded) {
          this.setData({ isRecordingAudio: false, audioButtonLabel: '录音' });
        }
        wx.showModal({
          title: '录音失败',
          content: explainRecorderError(error),
          showCancel: false,
          confirmText: '知道了',
        });
      });
    }
    this.fetchRoom({ showLoading: true });
  },

  onShow() {
    this.fetchRoom({ silent: true });
    this.startRoomPolling();
  },

  onHide() {
    this.stopRoomPolling();
    this.stopAudioRecording();
  },

  onUnload() {
    this.isPageUnloaded = true;
    Object.values(this.draftStateReportTimers || {}).forEach((timer) => clearTimeout(timer));
    this.draftStateReportTimers = {};
    this.stopRoomPolling();
    this.stopAudioRecording();
  },

  startRoomPolling() {
    this.stopRoomPolling();
    if (!this.data.roomId) {
      return;
    }
    roomPollingTimer = setInterval(() => {
      if (roomPollingInFlight || this.data.isLeavingForHistory) {
        return;
      }
      this.fetchRoom({ silent: true });
    }, 1000);
  },

  stopRoomPolling() {
    if (roomPollingTimer) {
      clearInterval(roomPollingTimer);
      roomPollingTimer = null;
    }
  },

  goHistoryWithFinishNotice() {
    if (this.data.isLeavingForHistory) {
      return;
    }
    this.stopRoomPolling();
    this.setData({ isLeavingForHistory: true });
    wx.showToast({
      title: '同行已结束，已回到纪念卡册',
      icon: 'none',
      duration: 1800,
    });
    setTimeout(() => {
      wx.switchTab({ url: '/pages/history/history' });
    }, 300);
  },

  async fetchRoom(options = {}) {
    const { showLoading = false, silent = false } = options;
    if (!this.data.roomId) {
      this.setData({ loading: false, room: null });
      return;
    }
    if (this.data.isLeavingForHistory) {
      return;
    }

    if (showLoading) {
      this.setData({ loading: true });
    }
    roomPollingInFlight = true;
    try {
      await app.ensureUserReady();
      const result = await getTeamRoomDetail({ roomId: this.data.roomId });
      const room = result.room || null;
      if (room && room.status === 'finished') {
        this.goHistoryWithFinishNotice();
        return;
      }
      const activeMission = this.data.activeMission || (room && room.themeSnapshot && room.themeSnapshot.missions && room.themeSnapshot.missions[0]) || '';
      const missionViews = withMissionSelection(groupMissionViews(room || {}), activeMission);
      this.setData({
        room,
        activeMission,
        missionViews,
        roomMemberCountLabel: `${room && room.teamStats ? room.teamStats.memberCount || ((room.members || []).length) : ((room && room.members) || []).length} 人同行`,
        roomMissionProgressLabel: `${room && room.teamStats ? room.teamStats.completedMissionCount || 0 : 0} / ${room && room.teamStats ? room.teamStats.totalMissionCount || 0 : 0} 个任务已点亮`,
      });
      this.syncEditorDraft(activeMission, room);
    } catch (error) {
      if (!silent) {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    } finally {
      roomPollingInFlight = false;
      if (showLoading) {
        this.setData({ loading: false });
      }
    }
  },

  getCurrentUserId() {
    const user = app.globalData.user || {};
    return user.openid || user.userId || user._id || '';
  },

  getDraftCache(mission) {
    if (!mission) {
      return null;
    }
    return this.missionDraftCache && this.missionDraftCache[mission]
      ? cloneDraft(this.missionDraftCache[mission])
      : null;
  },

  isDraftDirty(mission) {
    return !!(mission && this.missionDraftDirtyMap && this.missionDraftDirtyMap[mission]);
  },

  cacheMissionDraft(mission, draft, dirty = false) {
    if (!mission) {
      return;
    }
    this.missionDraftCache = this.missionDraftCache || {};
    this.missionDraftDirtyMap = this.missionDraftDirtyMap || {};
    this.missionDraftCache[mission] = cloneDraft(draft);
    this.missionDraftDirtyMap[mission] = !!dirty;
    this.scheduleDraftStateReport(mission, draft, !!dirty);
  },

  scheduleDraftStateReport(mission, draft, dirty) {
    if (!mission || !this.data.roomId) {
      return;
    }
    this.draftStateReportTimers = this.draftStateReportTimers || {};
    if (this.draftStateReportTimers[mission]) {
      clearTimeout(this.draftStateReportTimers[mission]);
    }
    this.draftStateReportTimers[mission] = setTimeout(() => {
      delete this.draftStateReportTimers[mission];
      updateTeamMemberDraftState({
        roomId: this.data.roomId,
        missionKey: mission,
        pending: !!dirty && hasDraftContent(draft),
        timestamp: Date.now(),
      }).catch(() => {});
    }, dirty ? 400 : 0);
  },

  updateMissionDraft(mission, updater, options = {}) {
    if (!mission || typeof updater !== 'function') {
      return;
    }
    const baseDraft = mission === this.data.activeMission
      ? cloneDraft(this.data.editorDraft)
      : (this.getDraftCache(mission) || createEmptyDraft());
    const nextDraft = cloneDraft(updater(baseDraft));
    if (mission === this.data.activeMission) {
      this.setEditorDraft(nextDraft, { mission, ...options });
      return;
    }
    const dirty = Object.prototype.hasOwnProperty.call(options, 'dirty') ? !!options.dirty : true;
    this.cacheMissionDraft(mission, nextDraft, dirty);
  },

  stopAudioRecording() {
    if (this.data.isRecordingAudio && recorderManager) {
      recorderManager.stop();
    }
  },

  setEditorDraft(nextDraft, options = {}) {
    const mission = options.mission || this.data.activeMission;
    const dirty = Object.prototype.hasOwnProperty.call(options, 'dirty') ? !!options.dirty : true;
    const draft = cloneDraft(nextDraft);
    this.cacheMissionDraft(mission, draft, dirty);
    this.setData({
      editorDraft: draft,
      completedClassName: draft.completed ? 'complete-check-active' : '',
    });
  },

  syncEditorDraft(mission, room = this.data.room, options = {}) {
    const { force = false } = options;
    if (!mission) {
      this.setEditorDraft(createEmptyDraft(), { mission: '', dirty: false });
      return;
    }

    if (!force && this.isDraftDirty(mission)) {
      const cachedDraft = this.getDraftCache(mission);
      if (cachedDraft) {
        this.setData({
          editorDraft: cachedDraft,
          completedClassName: cachedDraft.completed ? 'complete-check-active' : '',
        });
        return;
      }
    }

    const userId = this.getCurrentUserId();
    const contribution = ((room && room.contributions) || []).find((item) => item.missionKey === mission && item.userId === userId);
    const nextDraft = buildDraftFromContribution(contribution);
    this.cacheMissionDraft(mission, nextDraft, false);
    this.setData({
      editorDraft: cloneDraft(nextDraft),
      completedClassName: nextDraft.completed ? 'complete-check-active' : '',
    });
  },

  selectMission(event) {
    const mission = event.currentTarget.dataset.mission;
    if (!mission) {
      return;
    }
    this.setData({
      activeMission: mission,
      missionViews: withMissionSelection(this.data.missionViews, mission),
    });
    this.syncEditorDraft(mission);
  },

  handleNoteInput(event) {
    this.setEditorDraft(resetDraftCheckIn({
      ...this.data.editorDraft,
      noteText: event.detail.value || '',
    }));
  },

  async choosePhoto() {
    try {
      await ensurePrivacyAuthorization(this, {
        title: '上传图片前说明',
        content: '选择图片仅用于当前团队任务记录保存，不会在你未操作时自动读取相册。',
      });
      const result = await chooseImage(6);
      this.setEditorDraft(resetDraftCheckIn({
        ...this.data.editorDraft,
        photoList: [...(this.data.editorDraft.photoList || []), ...((result.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean))],
      }));
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

  async chooseVideo() {
    try {
      await ensurePrivacyAuthorization(this, {
        title: '上传视频前说明',
        content: '选择或拍摄视频仅用于当前团队任务记录保存，不会在你未操作时自动启用。',
      });
      const result = await chooseVideo(1);
      const selectedVideos = (result.tempFiles || []).filter(Boolean);
      const oversizedVideo = selectedVideos.find((item) => Number(item.size || 0) > MAX_VIDEO_UPLOAD_SIZE_BYTES);
      if (oversizedVideo) {
        wx.showModal({
          title: '视频太大了',
          content: `单个视频需控制在 ${formatFileSize(MAX_VIDEO_UPLOAD_SIZE_BYTES)} 内，建议裁剪后再上传。`,
          showCancel: false,
          confirmText: '知道了',
        });
        return;
      }
      const largeVideo = selectedVideos.find((item) => Number(item.size || 0) > LARGE_VIDEO_WARNING_SIZE_BYTES);
      if (largeVideo) {
        wx.showModal({
          title: '视频较大',
          content: `当前视频约 ${formatFileSize(largeVideo.size)}，弱网下上传会更久，建议尽量压缩后再同步。`,
          showCancel: false,
          confirmText: '继续',
        });
      }
      this.setEditorDraft(resetDraftCheckIn({
        ...this.data.editorDraft,
        videoList: [...(this.data.editorDraft.videoList || []), ...selectedVideos.map((item) => item.tempFilePath).filter(Boolean)],
      }));
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

  async toggleAudioRecording() {
    if (!recorderManager) {
      wx.showToast({ title: '当前环境不支持录音', icon: 'none' });
      return;
    }
    if (this.data.isRecordingAudio) {
      this.setData({ audioButtonLabel: '录音' });
      this.recordingMission = this.recordingMission || this.data.activeMission;
      recorderManager.stop();
      return;
    }
    try {
      await ensurePrivacyAuthorization(this, {
        title: '录音前说明',
        content: '录音仅在你主动点击后开始，用于当前团队任务记录补充，不会在后台自动录制。',
      });
      this.recordingMission = this.data.activeMission;
      this.setData({ isRecordingAudio: true, audioButtonLabel: '结束录音' });
      recorderManager.start({
        duration: 60000,
        format: 'mp3',
      });
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

  removePhoto(event) {
    const index = Number(event.currentTarget.dataset.index);
    const photoList = [...(this.data.editorDraft.photoList || [])];
    photoList.splice(index, 1);
    this.setEditorDraft(resetDraftCheckIn({ ...this.data.editorDraft, photoList }));
  },

  removeVideo(event) {
    const index = Number(event.currentTarget.dataset.index);
    const videoList = [...(this.data.editorDraft.videoList || [])];
    videoList.splice(index, 1);
    this.setEditorDraft(resetDraftCheckIn({ ...this.data.editorDraft, videoList }));
  },

  removeAudio(event) {
    const index = Number(event.currentTarget.dataset.index);
    const audioList = [...(this.data.editorDraft.audioList || [])];
    audioList.splice(index, 1);
    this.setEditorDraft(resetDraftCheckIn({ ...this.data.editorDraft, audioList }));
  },

  async ensureDraftCompanionNote(draft) {
    const nextDraft = cloneDraft(draft);
    const userNoteText = String(nextDraft.noteText || '').trim();
    const photoList = Array.isArray(nextDraft.photoList) ? nextDraft.photoList.filter(Boolean) : [];
    if (!userNoteText && !photoList.length) {
      return nextDraft;
    }
    if (nextDraft.companionNote) {
      return nextDraft;
    }
    try {
      const result = await generateCompanionNote({
        themeTitle: this.data.room && this.data.room.themeTitle ? this.data.room.themeTitle : '',
        locationName: this.data.room && this.data.room.locationName ? this.data.room.locationName : '',
        mission: this.data.activeMission || '',
        userNoteText,
        photoList,
      });
      nextDraft.companionNote = String((result && result.companionNote) || '').trim();
    } catch (error) {
      nextDraft.companionNote = nextDraft.companionNote || '';
    }
    return nextDraft;
  },

  hasPendingUnsyncedContent() {
    const missionKeys = new Set([
      ...Object.keys(this.missionDraftDirtyMap || {}),
      ...Object.keys(this.missionDraftCache || {}),
    ]);
    if (this.data.activeMission) {
      missionKeys.add(this.data.activeMission);
    }
    return Array.from(missionKeys).some((mission) => {
      if (!mission || !this.isDraftDirty(mission)) {
        return false;
      }
      const draft = mission === this.data.activeMission
        ? cloneDraft(this.data.editorDraft)
        : this.getDraftCache(mission);
      return hasDraftContent(draft);
    });
  },

  async collectUploadJobs(draft = this.data.editorDraft) {
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

    (draft.photoList || []).forEach((item) => pushJob(item, 'image'));
    (draft.videoList || []).forEach((item) => pushJob(item, 'video'));
    (draft.audioList || []).forEach((item) => pushJob(item, 'audio'));
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
    this.setData({
      saveStatusText: text || '正在同步给团队...',
      uploadProgressCurrent: current || 0,
      uploadProgressTotal: total || 0,
      uploadProgressPercent: safePercent,
    });
    wx.showLoading({
      title: safePercent > 0 ? `${Math.min(safePercent, 99)}%` : '同步中',
      mask: true,
    });
  },

  async uploadJobsSequentially(uploadJobs = []) {
    const total = uploadJobs.length;
    const uploadResultMap = {};
    if (!total) {
      this.updateSaveProgress('正在整理团队记录...', 0, 0, 100);
      return uploadResultMap;
    }

    for (let index = 0; index < uploadJobs.length; index += 1) {
      const job = uploadJobs[index];
      const current = index + 1;
      this.updateSaveProgress(`正在上传${job.label} ${current}/${total}`, current, total, ((current - 1) / total) * 100);
      const result = await this.uploadAssetWithRetry(job, current, total);
      uploadResultMap[job.key] = result;
    }
    this.updateSaveProgress('正在同步团队记录...', total, total, 100);
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
    if (!filePath || isRemoteAsset(filePath)) {
      return Promise.resolve(filePath);
    }
    return requestUpload(filePath, { kind }, options);
  },

  async handleSubmit() {
    if (!this.data.activeMission) {
      wx.showToast({ title: '先选择一个任务', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      let preparedDraft = cloneDraft(this.data.editorDraft);
      const intendedCompleted = hasDraftContent(preparedDraft);
      preparedDraft = {
        ...preparedDraft,
        completed: intendedCompleted,
      };
      if (intendedCompleted) {
        preparedDraft = await this.ensureDraftCompanionNote(preparedDraft);
      } else {
        preparedDraft = {
          ...preparedDraft,
          companionNote: '',
        };
      }
      this.setEditorDraft(preparedDraft);
      const uploadJobs = await this.collectUploadJobs(preparedDraft);
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
      const photoList = (preparedDraft.photoList || []).map((item) => resolveUploadedAsset(item, 'image'));
      const videoList = (preparedDraft.videoList || []).map((item) => resolveUploadedAsset(item, 'video'));
      const audioList = (preparedDraft.audioList || []).map((item) => resolveUploadedAsset(item, 'audio'));
      const result = await submitTeamContribution({
        roomId: this.data.roomId,
        missionKey: this.data.activeMission,
        missionLabel: this.data.activeMission,
        noteText: preparedDraft.noteText,
        photoList,
        videoList,
        audioList,
        companionNote: preparedDraft.companionNote || '',
        completed: !!preparedDraft.completed,
      });
      const room = result.room || this.data.room;
      const missionViews = withMissionSelection(groupMissionViews(room || {}), this.data.activeMission);
      const syncedDraft = {
        ...preparedDraft,
        photoList,
        videoList,
        audioList,
      };
      this.cacheMissionDraft(this.data.activeMission, syncedDraft, false);
      this.setData({
        room,
        missionViews,
        editorDraft: syncedDraft,
        completedClassName: syncedDraft.completed ? 'complete-check-active' : '',
      });
      wx.showToast({ title: '已同步到团队', icon: 'success' });
    } catch (error) {
      const fallbackMessage = explainSubmitFailure(error);
      const errorMessage = String((error && error.message) || '');
      wx.showToast({ title: (errorMessage ? `提交失败：${errorMessage}` : fallbackMessage).slice(0, 20), icon: 'none', duration: 3000 });
    } finally {
      wx.hideLoading();
      this.setData({
        saving: false,
        saveStatusText: '',
        uploadProgressPercent: 0,
        uploadProgressCurrent: 0,
        uploadProgressTotal: 0,
      });
    }
  },

  async handleFinish() {
    const room = this.data.room;
    if (!(room && room.memberRole === 'owner')) {
      return;
    }
    const pendingMemberNotice = buildPendingMemberNotice(room && room.members, this.getCurrentUserId());
    if (this.hasPendingUnsyncedContent()) {
      wx.showModal({
        title: '先同步最新内容',
        content: '你当前还有带内容的任务改动没有同步给团队，先点“同步给团队”再结束同行。',
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }
    if (pendingMemberNotice) {
      wx.showModal({
        title: '还有成员未同步',
        content: `${pendingMemberNotice}，暂时不能结束同行。`,
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '结束同行漫步？',
        content: '结束后会生成团队结果页。',
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    if (!modal.confirm) {
      return;
    }
    wx.showLoading({ title: '正在汇总' });
    try {
      await finishTeamWalk({ roomId: this.data.roomId });
      this.goHistoryWithFinishNotice();
    } catch (error) {
      const rawMessage = String((error && error.message) || (error && error.errMsg) || '');
      const pendingMatch = rawMessage.match(/pending_member_sync:([^,\n]+)/);
      if (pendingMatch) {
        wx.showModal({
          title: '还有成员未同步',
          content: `${pendingMatch[1]} 还有带内容的任务改动没同步，暂时不能结束同行。`,
          showCancel: false,
          confirmText: '知道了',
        });
        this.fetchRoom({ silent: true });
      } else {
        wx.showToast({ title: '结束失败', icon: 'none' });
      }
    } finally {
      wx.hideLoading();
    }
  },

  goRoom() {
    wx.navigateTo({ url: `/pages/team-room/team-room?roomId=${encodeURIComponent(this.data.roomId)}` });
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
});

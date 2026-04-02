const app = getApp();
const { requestUpload } = require('../../services/api');
const { finishTeamWalk, getTeamRoomDetail, submitTeamContribution } = require('../../services/team');
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

function createEmptyDraft() {
  return {
    noteText: '',
    photoList: [],
    videoList: [],
    audioList: [],
    completed: false,
  };
}

function cloneDraft(draft) {
  return {
    noteText: String((draft && draft.noteText) || ''),
    photoList: Array.isArray(draft && draft.photoList) ? [...draft.photoList] : [],
    videoList: Array.isArray(draft && draft.videoList) ? [...draft.videoList] : [],
    audioList: Array.isArray(draft && draft.audioList) ? [...draft.audioList] : [],
    completed: !!(draft && draft.completed),
  };
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

Page({
  data: {
    loading: true,
    saving: false,
    isRecordingAudio: false,
    roomId: '',
    room: null,
    activeMission: '',
    missionViews: [],
    editorDraft: createEmptyDraft(),
    roomMemberCountLabel: '0 人同行',
    roomMissionProgressLabel: '0 / 0 个任务已点亮',
    roomLocationContextLabel: '城市街道',
    audioButtonLabel: '录音',
    completedClassName: '',
    isLeavingForHistory: false,
    privacyPopup: createDefaultPrivacyPopup(),
  },

  onLoad(query) {
    this.missionDraftCache = {};
    this.missionDraftDirtyMap = {};
    this.setData({ roomId: query.roomId || query.id || '' });
    if (wx.getRecorderManager) {
      recorderManager = wx.getRecorderManager();
      recorderManager.onStop((result) => {
        this.setEditorDraft({
          ...this.data.editorDraft,
          audioList: [...(this.data.editorDraft.audioList || []), { tempFilePath: result.tempFilePath, duration: result.duration || 0 }],
        });
        this.setData({
          isRecordingAudio: false,
          audioButtonLabel: '录音',
        });
      });
      recorderManager.onError((error) => {
        this.setData({ isRecordingAudio: false, audioButtonLabel: '录音' });
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
  },

  onUnload() {
    this.stopRoomPolling();
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
        roomLocationContextLabel: room && room.locationContext ? room.locationContext : '城市街道',
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
    this.setEditorDraft({
      ...this.data.editorDraft,
      noteText: event.detail.value || '',
    });
  },

  toggleCompleted() {
    this.setEditorDraft({
      ...this.data.editorDraft,
      completed: !this.data.editorDraft.completed,
    });
  },

  async choosePhoto() {
    try {
      await ensurePrivacyAuthorization(this, {
        title: '上传图片前说明',
        content: '选择图片仅用于当前团队任务记录保存，不会在你未操作时自动读取相册。',
      });
      const result = await chooseImage(6);
      this.setEditorDraft({
        ...this.data.editorDraft,
        photoList: [...(this.data.editorDraft.photoList || []), ...((result.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean))],
      });
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
      this.setEditorDraft({
        ...this.data.editorDraft,
        videoList: [...(this.data.editorDraft.videoList || []), ...((result.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean))],
      });
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
      recorderManager.stop();
      return;
    }
    try {
      await ensurePrivacyAuthorization(this, {
        title: '录音前说明',
        content: '录音仅在你主动点击后开始，用于当前团队任务记录补充，不会在后台自动录制。',
      });
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
    this.setEditorDraft({ ...this.data.editorDraft, photoList });
  },

  removeVideo(event) {
    const index = Number(event.currentTarget.dataset.index);
    const videoList = [...(this.data.editorDraft.videoList || [])];
    videoList.splice(index, 1);
    this.setEditorDraft({ ...this.data.editorDraft, videoList });
  },

  removeAudio(event) {
    const index = Number(event.currentTarget.dataset.index);
    const audioList = [...(this.data.editorDraft.audioList || [])];
    audioList.splice(index, 1);
    this.setEditorDraft({ ...this.data.editorDraft, audioList });
  },

  uploadAsset(filePath, kind) {
    if (!filePath || String(filePath).startsWith('cloud://') || String(filePath).startsWith('http')) {
      return Promise.resolve(filePath);
    }
    return requestUpload(filePath, { kind });
  },

  async handleSubmit() {
    if (!this.data.activeMission) {
      wx.showToast({ title: '先选择一个任务', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      const photoList = await Promise.all((this.data.editorDraft.photoList || []).map((item) => this.uploadAsset(item, 'image')));
      const videoList = await Promise.all((this.data.editorDraft.videoList || []).map((item) => this.uploadAsset(item.tempFilePath || item, 'video')));
      const audioList = await Promise.all((this.data.editorDraft.audioList || []).map((item) => this.uploadAsset(item.tempFilePath || item, 'audio')));
      const result = await submitTeamContribution({
        roomId: this.data.roomId,
        missionKey: this.data.activeMission,
        missionLabel: this.data.activeMission,
        noteText: this.data.editorDraft.noteText,
        photoList,
        videoList,
        audioList,
        completed: !!this.data.editorDraft.completed,
      });
      const room = result.room || this.data.room;
      const missionViews = withMissionSelection(groupMissionViews(room || {}), this.data.activeMission);
      const syncedDraft = {
        ...this.data.editorDraft,
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
      wx.showToast({ title: explainSubmitFailure(error), icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async handleFinish() {
    const room = this.data.room;
    if (!(room && room.memberRole === 'owner')) {
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
      wx.showToast({ title: '结束失败', icon: 'none' });
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

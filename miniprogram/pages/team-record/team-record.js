const app = getApp();
const { requestUpload } = require('../../services/api');
const { finishTeamWalk, getTeamRoomDetail, submitTeamContribution } = require('../../services/team');
const { chooseImage, chooseVideo } = require('../../utils/media');

let recorderManager = null;

function createEmptyDraft() {
  return {
    noteText: '',
    photoList: [],
    videoList: [],
    audioList: [],
    completed: false,
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
  },

  onLoad(query) {
    this.setData({ roomId: query.roomId || query.id || '' });
    if (wx.getRecorderManager) {
      recorderManager = wx.getRecorderManager();
      recorderManager.onStop((result) => {
        this.setData({
          editorDraft: {
            ...this.data.editorDraft,
            audioList: [...(this.data.editorDraft.audioList || []), { tempFilePath: result.tempFilePath, duration: result.duration || 0 }],
          },
          isRecordingAudio: false,
          audioButtonLabel: '录音',
        });
      });
      recorderManager.onError(() => {
        this.setData({ isRecordingAudio: false, audioButtonLabel: '录音' });
        wx.showToast({ title: '录音失败', icon: 'none' });
      });
    }
    this.fetchRoom();
  },

  async fetchRoom() {
    if (!this.data.roomId) {
      this.setData({ loading: false, room: null });
      return;
    }

    this.setData({ loading: true });
    try {
      await app.ensureUserReady();
      const result = await getTeamRoomDetail({ roomId: this.data.roomId });
      const room = result.room || null;
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
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  getCurrentUserId() {
    const user = app.globalData.user || {};
    return user.openid || user.userId || user._id || '';
  },

  syncEditorDraft(mission, room = this.data.room) {
    const userId = this.getCurrentUserId();
    const contribution = ((room && room.contributions) || []).find((item) => item.missionKey === mission && item.userId === userId);
    if (!contribution) {
      this.setData({ editorDraft: createEmptyDraft(), completedClassName: '' });
      return;
    }
    this.setData({
      editorDraft: {
        noteText: contribution.noteText || '',
        photoList: [...(contribution.photoList || [])],
        videoList: [...(contribution.videoList || [])],
        audioList: [...(contribution.audioList || [])],
        completed: !!contribution.completed,
      },
      completedClassName: contribution.completed ? 'complete-check-active' : '',
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
    this.setData({
      editorDraft: {
        ...this.data.editorDraft,
        noteText: event.detail.value || '',
      },
    });
  },

  toggleCompleted() {
    this.setData({
      editorDraft: {
        ...this.data.editorDraft,
        completed: !this.data.editorDraft.completed,
      },
      completedClassName: !this.data.editorDraft.completed ? 'complete-check-active' : '',
    });
  },

  async choosePhoto() {
    try {
      const result = await chooseImage(6);
      this.setData({
        editorDraft: {
          ...this.data.editorDraft,
          photoList: [...(this.data.editorDraft.photoList || []), ...((result.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean))],
        },
      });
    } catch (error) {
      wx.showToast({ title: '图片选择失败', icon: 'none' });
    }
  },

  async chooseVideo() {
    try {
      const result = await chooseVideo(1);
      this.setData({
        editorDraft: {
          ...this.data.editorDraft,
          videoList: [...(this.data.editorDraft.videoList || []), ...((result.tempFiles || []).map((item) => item.tempFilePath).filter(Boolean))],
        },
      });
    } catch (error) {
      wx.showToast({ title: '视频选择失败', icon: 'none' });
    }
  },

  toggleAudioRecording() {
    if (!recorderManager) {
      wx.showToast({ title: '当前环境不支持录音', icon: 'none' });
      return;
    }
    if (this.data.isRecordingAudio) {
      this.setData({ audioButtonLabel: '录音' });
      recorderManager.stop();
      return;
    }
    this.setData({ isRecordingAudio: true, audioButtonLabel: '结束录音' });
    recorderManager.start({
      duration: 60000,
      format: 'mp3',
    });
  },

  removePhoto(event) {
    const index = Number(event.currentTarget.dataset.index);
    const photoList = [...(this.data.editorDraft.photoList || [])];
    photoList.splice(index, 1);
    this.setData({ editorDraft: { ...this.data.editorDraft, photoList } });
  },

  removeVideo(event) {
    const index = Number(event.currentTarget.dataset.index);
    const videoList = [...(this.data.editorDraft.videoList || [])];
    videoList.splice(index, 1);
    this.setData({ editorDraft: { ...this.data.editorDraft, videoList } });
  },

  removeAudio(event) {
    const index = Number(event.currentTarget.dataset.index);
    const audioList = [...(this.data.editorDraft.audioList || [])];
    audioList.splice(index, 1);
    this.setData({ editorDraft: { ...this.data.editorDraft, audioList } });
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
      this.setData({
        room,
        missionViews,
        editorDraft: {
          ...this.data.editorDraft,
          photoList,
          videoList,
          audioList,
        },
      });
      wx.showToast({ title: '已同步到团队', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: '提交失败', icon: 'none' });
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
      wx.redirectTo({ url: `/pages/team-detail/team-detail?roomId=${encodeURIComponent(this.data.roomId)}` });
    } catch (error) {
      wx.showToast({ title: '结束失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goRoom() {
    wx.navigateTo({ url: `/pages/team-room/team-room?roomId=${encodeURIComponent(this.data.roomId)}` });
  },
});

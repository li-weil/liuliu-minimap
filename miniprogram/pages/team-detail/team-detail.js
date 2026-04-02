const { generateCompanionNote } = require('../../services/sticker');
const { deleteTeamWalk, getTeamWalkDetail } = require('../../services/team');
const { formatDate } = require('../../utils/format');

function normalizeMediaItem(item) {
  if (typeof item === 'string') {
    return item;
  }
  if (item && item.tempFilePath) {
    return item.tempFilePath;
  }
  if (item && item.url) {
    return item.url;
  }
  return '';
}

function normalizeMediaList(list) {
  return Array.isArray(list) ? list.map(normalizeMediaItem).filter(Boolean) : [];
}

function buildMissionGroups(room) {
  const missions = Array.isArray(room && room.themeSnapshot && room.themeSnapshot.missions)
    ? room.themeSnapshot.missions
    : [];
  const contributions = Array.isArray(room && room.contributions) ? room.contributions : [];

  return missions.map((mission) => {
    const missionContributions = contributions
      .filter((item) => item && item.missionKey === mission)
      .map((item) => ({
        id: item._id || item.id || `${mission}-${item.userId || ''}`,
        userId: item.userId || '',
        nickName: item.nickName || '队友',
        avatarUrl: item.avatarUrl || '',
        noteText: String(item.noteText || '').trim(),
        noteTextDisplay: String(item.noteText || '').trim() || '这位同行者这次主要用图片和声音留下了记录。',
        photoList: normalizeMediaList(item.photoList),
        videoList: normalizeMediaList(item.videoList),
        audioList: normalizeMediaList(item.audioList),
        completed: !!item.completed,
        companionNote: String(item.companionNote || '').trim(),
        createdAt: item.createdAt || 0,
        updatedAt: item.updatedAt || 0,
        updatedAtLabel: formatDate(item.updatedAt || item.createdAt || Date.now()),
      }))
      .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));

    const aggregate = missionContributions.reduce((result, item) => {
      result.photoCount += item.photoList.length;
      result.videoCount += item.videoList.length;
      result.audioCount += item.audioList.length;
      return result;
    }, {
      photoCount: 0,
      videoCount: 0,
      audioCount: 0,
    });

    const completed = missionContributions.some((item) => item.completed);

    return {
      mission,
      completed,
      completedLabel: completed ? '团队已点亮' : '仍待完成',
      contributionCount: missionContributions.length,
      aggregate,
      contributions: missionContributions,
    };
  });
}

function decorateMissionGroupsActive(missionGroups, activeMission) {
  return (Array.isArray(missionGroups) ? missionGroups : []).map((item) => ({
    ...item,
    isActive: !!(activeMission && item.mission === activeMission),
    rowClass: activeMission && item.mission === activeMission ? 'mission-row mission-row-active' : 'mission-row',
    anchorClass: activeMission && item.mission === activeMission ? 'mission-anchor mission-anchor-active' : 'mission-anchor',
  }));
}

function explainDeleteFailure(error) {
  const raw = String((error && error.message) || (error && error.errMsg) || '').toLowerCase();
  if (!raw) {
    return '删除失败，请稍后再试';
  }
  if (raw.includes('permission_denied')) {
    return '你还不能删除这场同行记录';
  }
  if (raw.includes('not_found')) {
    return '这条同行记录已经不存在了';
  }
  if (raw.includes('missing_id')) {
    return '缺少记录编号，暂时无法删除';
  }
  if (raw.includes('walk_not_finished')) {
    return '未结束的同行记录还不能删除';
  }
  if (raw.includes('function not found') || raw.includes('cloud function')) {
    return '删除云函数还没部署，请先上传 deleteTeamWalk';
  }
  return '删除失败，请稍后再试';
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

Page({
  data: {
    loading: true,
    roomId: '',
    room: null,
    missionGroups: [],
    hasMissionGroups: false,
    statusLabel: '进行中',
    locationContextLabel: '城市街道',
    canResume: false,
    canEnterRoom: false,
    showActionButton: false,
    actionLabel: '',
    activeMission: '',
    currentMissionCardSrc: '',
    isRenderingMissionCard: false,
    missionCardRenderPayload: {
      mission: '',
      entries: [],
      locationName: '',
      themeTitle: '',
      dateLabel: '',
      renderVersion: 0,
    },
    showMissionCardModal: false,
    missionCardModal: {
      title: '',
      imageSrc: '',
    },
    isDeleting: false,
  },

  onLoad(query) {
    this.missionCardRenderVersion = 0;
    this.prepareMissionToken = 0;
    this.setData({ roomId: query.roomId || query.id || '' });
    this.fetchDetail();
  },

  onShareAppMessage() {
    const room = this.data.room;
    return {
      title: room ? `${room.themeTitle}｜我们的同行漫步` : '我们的同行漫步',
      path: `/pages/team-detail/team-detail?roomId=${encodeURIComponent(this.data.roomId)}`,
      imageUrl: room && room.coverImage ? room.coverImage : '',
    };
  },

  async fetchDetail() {
    if (!this.data.roomId) {
      this.setData({ loading: false, room: null });
      return;
    }
    this.setData({ loading: true });
    try {
      const result = await getTeamWalkDetail({ roomId: this.data.roomId });
      const room = result.room || null;
      const status = room && room.status ? room.status : '';
      const missionGroups = buildMissionGroups(room || {});
      const nextActiveMission = missionGroups.length
        ? (this.data.activeMission && missionGroups.some((item) => item.mission === this.data.activeMission)
          ? this.data.activeMission
          : missionGroups[0].mission)
        : '';
      const canResume = status === 'active';
      const canEnterRoom = status === 'waiting';
      const decoratedMissionGroups = decorateMissionGroupsActive(missionGroups, nextActiveMission);
      this.setData({
        room: room ? {
          ...room,
          createdAtLabel: formatDate(room.createdAt),
          endedAtLabel: room.endedAt ? formatDate(room.endedAt) : '',
        } : null,
        missionGroups: decoratedMissionGroups,
        hasMissionGroups: decoratedMissionGroups.length > 0,
        statusLabel: status === 'finished' ? '已结束' : (status === 'waiting' ? '待出发' : '进行中'),
        locationContextLabel: room && room.locationContext ? room.locationContext : '城市街道',
        canResume,
        canEnterRoom,
        showActionButton: canResume || canEnterRoom,
        actionLabel: canResume ? '重新进入这场同行' : (canEnterRoom ? '进入房间继续组队' : ''),
        activeMission: nextActiveMission,
      }, () => {
        this.prepareMissionCard();
      });
    } catch (error) {
      wx.showToast({ title: '详情加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  getActiveMissionGroup() {
    const activeMission = this.data.activeMission;
    const missionGroups = Array.isArray(this.data.missionGroups) ? this.data.missionGroups : [];
    if (!activeMission) {
      return null;
    }
    return missionGroups.find((item) => item.mission === activeMission) || null;
  },

  updateMissionContributions(mission, nextContributions) {
    const missionGroups = (this.data.missionGroups || []).map((group) => (
      group.mission === mission
        ? { ...group, contributions: nextContributions }
        : group
    ));
    this.setData({
      missionGroups: decorateMissionGroupsActive(missionGroups, this.data.activeMission),
      hasMissionGroups: missionGroups.length > 0,
    });
  },

  async prepareMissionCard() {
    const token = Date.now();
    this.prepareMissionToken = token;
    const group = this.getActiveMissionGroup();
    if (!group || !Array.isArray(group.contributions) || !group.contributions.length) {
      this.setData({
        currentMissionCardSrc: '',
        isRenderingMissionCard: false,
        missionCardRenderPayload: {
          mission: '',
          entries: [],
          locationName: '',
          themeTitle: '',
          dateLabel: '',
          renderVersion: 0,
        },
      });
      return;
    }

    let nextContributions = group.contributions.slice();
    const room = this.data.room || {};

    nextContributions = await Promise.all(nextContributions.map(async (item) => {
      if (item.companionNote || (!item.noteText && !item.photoList.length)) {
        return item;
      }
      try {
        const result = await generateCompanionNote({
          themeTitle: room.themeTitle || '',
          locationName: room.locationName || '',
          locationContext: room.locationContext || '',
          mission: group.mission || '',
          userNoteText: item.noteText || '',
          photoList: item.photoList || [],
        });
        if (result && result.companionNote) {
          return {
            ...item,
            companionNote: result.companionNote,
          };
        }
      } catch (error) {
        // Ignore AI note generation failure and still render the stacked card.
      }
      return item;
    }));

    if (this.prepareMissionToken !== token) {
      return;
    }

    this.updateMissionContributions(group.mission, nextContributions);

    this.missionCardRenderVersion += 1;
    this.setData({
      currentMissionCardSrc: '',
      isRenderingMissionCard: true,
      missionCardRenderPayload: {
        mission: group.mission || '团队打卡卡片',
        entries: nextContributions.map((item) => ({
          authorName: item.nickName || '队友',
          noteText: item.noteText || '',
          companionNote: item.companionNote || '',
          photoList: item.photoList || [],
        })),
        locationName: room.locationName || '',
        themeTitle: room.themeTitle || '',
        dateLabel: room.endedAtLabel || room.createdAtLabel || '',
        renderVersion: this.missionCardRenderVersion,
      },
    });
  },

  handleMissionCardGenerated(event) {
    const tempFilePath = event.detail && event.detail.tempFilePath ? event.detail.tempFilePath : '';
    const mission = event.detail && event.detail.mission ? event.detail.mission : '';
    const activeMissionGroup = this.getActiveMissionGroup();
    const activeMissionLabel = activeMissionGroup ? activeMissionGroup.mission : '';
    if (!tempFilePath || !activeMissionLabel || mission !== activeMissionLabel) {
      return;
    }
    this.setData({
      currentMissionCardSrc: tempFilePath,
      isRenderingMissionCard: false,
    });
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
      await ensureAlbumPermission();
      const filePath = await this.resolveMissionCardFilePath();
      if (!filePath) {
        throw new Error('missing_mission_card');
      }
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

  handleResume() {
    if (!this.data.roomId) {
      return;
    }
    if (this.data.canEnterRoom) {
      wx.navigateTo({
        url: `/pages/team-room/team-room?roomId=${encodeURIComponent(this.data.roomId)}`,
      });
      return;
    }
    if (!this.data.canResume) {
      return;
    }
    wx.navigateTo({
      url: `/pages/team-record/team-record?roomId=${encodeURIComponent(this.data.roomId)}`,
    });
  },

  switchMissionTab(event) {
    const mission = event.currentTarget.dataset.mission;
    const nextMission = this.data.activeMission === mission ? '' : mission;
    this.setData({
      activeMission: nextMission,
      missionGroups: decorateMissionGroupsActive(this.data.missionGroups, nextMission),
    }, () => {
      this.prepareMissionCard();
    });
  },

  async handleDeleteTeamWalk() {
    const room = this.data.room;
    const roomId = this.data.roomId;
    if (!roomId || this.data.isDeleting) {
      return;
    }
    if (!room || room.status !== 'finished') {
      wx.showToast({ title: '未结束的同行记录还不能删除', icon: 'none' });
      return;
    }

    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '删除这条同行记录？',
        content: '删除后将无法恢复，这场同行的成员、任务和动态记录都会一并移除。',
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

    this.setData({ isDeleting: true });
    try {
      const result = await deleteTeamWalk({ roomId });
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
      this.setData({ isDeleting: false });
    }
  },

  noop() {},
});

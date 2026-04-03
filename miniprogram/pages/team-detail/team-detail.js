const { requestUpload } = require('../../services/api');
const { deleteTeamWalk, getTeamWalkDetail, saveTeamMissionCard } = require('../../services/team');
const { batchResolveCloudFileIds, isCloudFileId } = require('../../services/asset');
const { formatDate } = require('../../utils/format');
const {
  createDefaultPrivacyPopup,
  ensurePrivacyAuthorization,
  openPrivacyContract,
  rejectPrivacyAuthorization,
  resolvePrivacyAuthorization,
} = require('../../utils/privacy');

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
        noteTextDisplay: String(item.noteText || '').trim() || '这个成员没有留下文字记录',
        photoList: normalizeMediaList(item.photoList),
        photoCount: Number(item.photoCount || 0),
        photoAuditStatus: item.photoAuditStatus || 'approved',
        videoList: normalizeMediaList(item.videoList),
        videoCount: Number(item.videoCount || 0),
        videoAuditStatus: item.videoAuditStatus || 'approved',
        audioList: normalizeMediaList(item.audioList),
        audioCount: Number(item.audioCount || 0),
        audioAuditStatus: item.audioAuditStatus || 'approved',
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
  const download = await downloadFile(finalUrl).catch(() => null);
  return download && download.tempFilePath ? download.tempFilePath : finalUrl;
}

async function hydrateMissionGroupsAudio(missionGroups = []) {
  const cache = {};
  return Promise.all((missionGroups || []).map(async (group) => ({
    ...group,
    contributions: await Promise.all((group.contributions || []).map(async (contribution) => ({
      ...contribution,
      audioList: await Promise.all((contribution.audioList || []).map(async (item) => {
        if (!item) {
          return item;
        }
        if (!cache[item]) {
          cache[item] = downloadAudioToLocal(item).catch(() => item);
        }
        return cache[item];
      })),
    }))),
  })));
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
    canResume: false,
    canEnterRoom: false,
    showActionButton: false,
    actionLabel: '',
    activeMission: '',
    currentMissionCardSrc: '',
    isRenderingMissionCard: false,
    missionCardPendingNote: false,
    missionCardPendingText: '',
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
    privacyPopup: createDefaultPrivacyPopup(),
  },

  onLoad(query) {
    this.missionCardRenderVersion = 0;
    this.prepareMissionToken = 0;
    this.pendingMissionRefreshTimer = null;
    this.setData({ roomId: query.roomId || query.id || '' });
    this.fetchDetail();
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
    if (!this.data.roomId || this.pendingMissionRefreshTimer) {
      return;
    }
    this.pendingMissionRefreshTimer = setTimeout(() => {
      this.pendingMissionRefreshTimer = null;
      if (this.data.isRenderingMissionCard) {
        return;
      }
      this.fetchDetail();
    }, 3000);
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
      const baseMissionGroups = buildMissionGroups(room || {});
      const missionGroups = await hydrateMissionGroupsAudio(baseMissionGroups);
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
      this.clearPendingMissionRefresh();
      this.setData({
        currentMissionCardSrc: '',
        isRenderingMissionCard: false,
        missionCardPendingNote: false,
        missionCardPendingText: '',
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
    const room = this.data.room || {};
    const storedCard =
      room &&
      room.missionCardMap &&
      room.missionCardMap[group.mission] &&
      room.missionCardMap[group.mission].cardImagePath
        ? room.missionCardMap[group.mission].cardImagePath
        : '';
    const waitingCompanionNote = !storedCard && group.contributions.some((item) => {
      const noteText = String(item.noteText || '').trim();
      const photoList = Array.isArray(item.photoList) ? item.photoList.filter(Boolean) : [];
      return (noteText || photoList.length) && !String(item.companionNote || '').trim();
    });
    if (waitingCompanionNote) {
      this.schedulePendingMissionRefresh();
    } else {
      this.clearPendingMissionRefresh();
    }
    this.setData({
      currentMissionCardSrc: storedCard,
      isRenderingMissionCard: false,
      missionCardPendingNote: waitingCompanionNote,
      missionCardPendingText: waitingCompanionNote ? '66 正在记录卡片…' : '',
      missionCardRenderPayload: {
        mission: group.mission || '团队打卡卡片',
        entries: group.contributions.map((item) => ({
          authorName: item.nickName || '队友',
          noteText: item.noteText || '',
          companionNote: item.companionNote || '',
          photoList: item.photoList || [],
        })),
        locationName: room.locationName || '',
        themeTitle: room.themeTitle || '',
        dateLabel: room.endedAtLabel || room.createdAtLabel || '',
        renderVersion: 0,
      },
    });
  },

  handleGenerateMissionCard() {
    const group = this.getActiveMissionGroup();
    const room = this.data.room || {};
    if (!group || !Array.isArray(group.contributions) || !group.contributions.length) {
      wx.showToast({ title: '这个任务还没有记录', icon: 'none' });
      return;
    }
    const waitingCompanionNote = !(
      room &&
      room.missionCardMap &&
      room.missionCardMap[group.mission] &&
      room.missionCardMap[group.mission].cardImagePath
    ) && group.contributions.some((item) => {
      const noteText = String(item.noteText || '').trim();
      const photoList = Array.isArray(item.photoList) ? item.photoList.filter(Boolean) : [];
      return (noteText || photoList.length) && !String(item.companionNote || '').trim();
    });
    if (waitingCompanionNote) {
      wx.showToast({ title: '正在准备团队卡片文案', icon: 'none' });
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
        mission: group.mission || '团队打卡卡片',
        entries: group.contributions.map((item) => ({
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

  async persistMissionCard(missionKey, tempFilePath) {
    if (!this.data.roomId || !missionKey || !tempFilePath) {
      return '';
    }
    const cardImagePath = await requestUpload(tempFilePath, { kind: 'image' });
    const result = await saveTeamMissionCard({
      roomId: this.data.roomId,
      missionKey,
      cardImagePath,
    });
    const room = this.data.room || {};
    const missionCardMap = result && result.missionCardMap
      ? result.missionCardMap
      : {
          ...(room.missionCardMap || {}),
          [missionKey]: { cardImagePath, updatedAt: Date.now() },
        };
    this.setData({
      room: {
        ...room,
        missionCardMap,
      },
    });
    return cardImagePath;
  },

  async handleMissionCardGenerated(event) {
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
      missionCardRenderPayload: {
        ...this.data.missionCardRenderPayload,
        renderVersion: 0,
      },
    });
    if (!activeMissionGroup || !activeMissionGroup.mission) {
      return;
    }
    try {
      await this.persistMissionCard(activeMissionGroup.mission, tempFilePath);
    } catch (error) {
      wx.showToast({ title: '卡片已生成，持久化失败', icon: 'none' });
    }
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
        content: '保存到本地时会使用相册相关能力，仅用于把这张团队打卡卡片存到你的设备相册中。',
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

  openFeedback(event) {
    if (!this.data.roomId) {
      return;
    }
    const dataset = event && event.currentTarget ? event.currentTarget.dataset || {} : {};
    const params = [
      'sourceType=team',
      `scene=${encodeURIComponent(dataset.scene || 'team-detail')}`,
      `sceneLabel=${encodeURIComponent('团队结果')}`,
      `roomId=${encodeURIComponent(this.data.roomId)}`,
    ];
    if (dataset.contributionId) {
      params.push(`contributionId=${encodeURIComponent(dataset.contributionId)}`);
    }
    if (dataset.missionKey) {
      params.push(`missionKey=${encodeURIComponent(dataset.missionKey)}`);
    }
    if (dataset.targetUserId) {
      params.push(`targetUserId=${encodeURIComponent(dataset.targetUserId)}`);
    }
    if (dataset.targetNickName) {
      params.push(`targetNickName=${encodeURIComponent(dataset.targetNickName)}`);
    }
    wx.navigateTo({
      url: `/pages/feedback/feedback?${params.join('&')}`,
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

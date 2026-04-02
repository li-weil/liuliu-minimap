const { finishTeamWalk, getTeamRoomDetail, leaveTeamRoom, startTeamWalk } = require('../../services/team');

function explainRoomStatus(status) {
  if (status === 'active') {
    return '队友都已就位，点击进入记录页开始共同完成任务。';
  }
  if (status === 'finished') {
    return '这场同行漫步已经结束，可以进入结果页回看团队记录。';
  }
  if (status === 'dissolved') {
    return '这个房间已经被解散。';
  }
  return '把这次主题分享给朋友，人齐后就一起出发吧';
}

Page({
  data: {
    loading: true,
    roomId: '',
    room: null,
    statusCopy: '',
    roomModeLabel: '纯粹模式',
    roomStatusLabel: '待出发',
    roomMemberCountLabel: '0 人',
    roomLocationContextLabel: '城市街道',
    leaveButtonLabel: '退出房间',
  },

  onLoad(query) {
    this.setData({ roomId: query.roomId || query.id || '' });
    this.fetchRoom({ showLoading: true });
  },

  onShow() {
    if (this.data.roomId) {
      this.startAutoRefresh();
      this.fetchRoom({ silent: true });
    }
  },

  onHide() {
    this.stopAutoRefresh();
  },

  onUnload() {
    this.stopAutoRefresh();
  },

  onShareAppMessage() {
    const room = this.data.room;
    return {
      title: room ? `${room.themeTitle}｜一起同行漫步吧` : '一起同行漫步吧',
      path: `/pages/team-join/team-join?roomId=${encodeURIComponent(this.data.roomId)}`,
      imageUrl: room && room.coverImage ? room.coverImage : '',
    };
  },

  buildRoomViewState(room) {
    return {
      room,
      statusCopy: explainRoomStatus((room && room.status) || 'waiting'),
      roomModeLabel: room && room.walkMode === 'advanced' ? '进阶模式' : '纯粹模式',
      roomStatusLabel:
        room && room.status === 'active'
          ? '进行中'
          : room && room.status === 'finished'
            ? '已结束'
            : room && room.status === 'dissolved'
              ? '已解散'
              : '待出发',
      roomMemberCountLabel: `${room && room.teamStats ? room.teamStats.memberCount || ((room.members || []).length) : ((room && room.members) || []).length} 人`,
      roomLocationContextLabel: room && room.locationContext ? room.locationContext : '城市街道',
      leaveButtonLabel: room && room.memberRole === 'owner' ? '解散房间' : '退出房间',
    };
  },

  async fetchRoom(options = {}) {
    if (!this.data.roomId) {
      this.setData({ loading: false, room: null });
      return;
    }

    const showLoading = !!options.showLoading;
    const silent = !!options.silent;
    if (showLoading) {
      this.setData({ loading: true });
    }
    try {
      const result = await getTeamRoomDetail({ roomId: this.data.roomId });
      const room = result.room || null;
      const nextState = this.buildRoomViewState(room);
      const prevRoom = this.data.room || null;
      const prevSignature = prevRoom ? JSON.stringify({
        status: prevRoom.status || '',
        members: prevRoom.members || [],
        activities: prevRoom.activities || [],
        teamStats: prevRoom.teamStats || {},
        memberRole: prevRoom.memberRole || '',
      }) : '';
      const nextSignature = room ? JSON.stringify({
        status: room.status || '',
        members: room.members || [],
        activities: room.activities || [],
        teamStats: room.teamStats || {},
        memberRole: room.memberRole || '',
      }) : '';

      if (!silent || prevSignature !== nextSignature) {
        this.setData(nextState);
      }
    } catch (error) {
      if (!silent) {
        wx.showToast({ title: '房间加载失败', icon: 'none' });
      }
    } finally {
      if (showLoading) {
        this.setData({ loading: false });
      }
    }
  },

  startAutoRefresh() {
    this.stopAutoRefresh();
    this.roomRefreshTimer = setInterval(() => {
      if (!this.data.roomId || this.data.loading) {
        return;
      }
      this.fetchRoom({ silent: true });
    }, 4000);
  },

  stopAutoRefresh() {
    if (this.roomRefreshTimer) {
      clearInterval(this.roomRefreshTimer);
      this.roomRefreshTimer = null;
    }
  },

  async handleStart() {
    const room = this.data.room;
    if (!(room && room.memberRole === 'owner')) {
      return;
    }

    wx.showLoading({ title: '正在出发' });
    try {
      const result = await startTeamWalk({ roomId: this.data.roomId });
      this.setData({ room: result.room || this.data.room });
      wx.navigateTo({ url: `/pages/team-record/team-record?roomId=${encodeURIComponent(this.data.roomId)}` });
    } catch (error) {
      wx.showToast({ title: '开始失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  goRecord() {
    wx.navigateTo({ url: `/pages/team-record/team-record?roomId=${encodeURIComponent(this.data.roomId)}` });
  },

  goDetail() {
    wx.navigateTo({ url: `/pages/team-detail/team-detail?roomId=${encodeURIComponent(this.data.roomId)}` });
  },

  openFeedback() {
    if (!this.data.roomId) {
      return;
    }
    wx.navigateTo({
      url: `/pages/feedback/feedback?sourceType=team&scene=team-room&sceneLabel=${encodeURIComponent('同行房间')}&roomId=${encodeURIComponent(this.data.roomId)}`,
    });
  },

  async handleLeave() {
    const room = this.data.room;
    if (!room) {
      return;
    }

    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: room.memberRole === 'owner' ? '解散房间？' : '退出房间？',
        content: room.memberRole === 'owner' ? '解散后所有队友都会失去这次房间入口。' : '退出后需要重新通过邀请链接才能回来。',
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    if (!modal.confirm) {
      return;
    }

    wx.showLoading({ title: room.memberRole === 'owner' ? '正在解散' : '正在退出' });
    try {
      await leaveTeamRoom({ roomId: this.data.roomId });
      this.stopAutoRefresh();
      wx.showToast({ title: room.memberRole === 'owner' ? '已解散' : '已退出', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack({
          fail: () => {
            wx.switchTab({ url: '/pages/index/index' });
          },
        });
      }, 500);
    } catch (error) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async handleFinish() {
    const room = this.data.room;
    if (!(room && room.memberRole === 'owner' && room.status === 'active')) {
      return;
    }
    const modal = await new Promise((resolve) => {
      wx.showModal({
        title: '结束同行漫步？',
        content: '结束后会生成团队结果页，成员将不能继续提交内容。',
        confirmText: '结束',
        success: resolve,
        fail: () => resolve({ confirm: false }),
      });
    });
    if (!modal.confirm) {
      return;
    }

    wx.showLoading({ title: '正在汇总' });
    try {
      this.stopAutoRefresh();
      await finishTeamWalk({ roomId: this.data.roomId });
      wx.navigateTo({ url: `/pages/team-detail/team-detail?roomId=${encodeURIComponent(this.data.roomId)}` });
    } catch (error) {
      wx.showToast({ title: '结束失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
});

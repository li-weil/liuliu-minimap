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
  return '把这次主题分享给朋友，等人齐之后就可以一起出发。';
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
    this.fetchRoom();
  },

  onShow() {
    if (this.data.roomId) {
      this.fetchRoom();
    }
  },

  onShareAppMessage() {
    const room = this.data.room;
    return {
      title: room ? `${room.themeTitle}｜一起同行漫步吧` : '一起同行漫步吧',
      path: `/pages/team-join/team-join?roomId=${encodeURIComponent(this.data.roomId)}`,
      imageUrl: room && room.coverImage ? room.coverImage : '',
    };
  },

  async fetchRoom() {
    if (!this.data.roomId) {
      this.setData({ loading: false, room: null });
      return;
    }

    this.setData({ loading: true });
    try {
      const result = await getTeamRoomDetail({ roomId: this.data.roomId });
      const room = result.room || null;
      this.setData({
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
      });
    } catch (error) {
      wx.showToast({ title: '房间加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
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
      await finishTeamWalk({ roomId: this.data.roomId });
      wx.navigateTo({ url: `/pages/team-detail/team-detail?roomId=${encodeURIComponent(this.data.roomId)}` });
    } catch (error) {
      wx.showToast({ title: '结束失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },
});

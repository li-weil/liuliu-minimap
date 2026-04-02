const app = getApp();
const { getTeamRoomDetail, joinTeamRoom } = require('../../services/team');
const { isManualLogoutSuppressed } = require('../../services/user');

Page({
  data: {
    loading: true,
    joining: false,
    roomId: '',
    room: null,
    roomModeLabel: '纯粹模式',
    roomLocationContextLabel: '城市街道',
    roomMemberCountLabel: '0 人已在房间',
  },

  onLoad(query) {
    this.setData({ roomId: query.roomId || query.id || '' });
    this.fetchRoom();
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
        roomModeLabel: room && room.walkMode === 'advanced' ? '进阶模式' : '纯粹模式',
        roomLocationContextLabel: room && room.locationContext ? room.locationContext : '城市街道',
        roomMemberCountLabel: `${((room && room.members) || []).length} 人已在房间`,
      });
    } catch (error) {
      wx.showToast({ title: '房间加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async handleJoin() {
    await app.ensureUserReady();
    if (!app.globalData.user) {
      const pausedLogin = isManualLogoutSuppressed();
      wx.showModal({
        title: pausedLogin ? '先恢复登录' : '先完善资料',
        content: pausedLogin
          ? '你刚刚主动退出过账号，去个人页点一次登录后，就能加入同行房间。'
          : '加入同行房间前，需要先在个人页设置一次头像和昵称。',
        confirmText: pausedLogin ? '去恢复' : '去设置',
        success: (res) => {
          if (res.confirm) {
            app.setPendingNavigation({
              url: `/pages/team-join/team-join?roomId=${encodeURIComponent(this.data.roomId)}`,
              mode: 'redirect',
            });
            wx.switchTab({ url: '/pages/profile/profile' });
          }
        },
      });
      return;
    }

    this.setData({ joining: true });
    try {
      const result = await joinTeamRoom({ roomId: this.data.roomId });
      if (!(result && result.joined)) {
        throw new Error('join_failed');
      }
      wx.redirectTo({ url: `/pages/team-room/team-room?roomId=${encodeURIComponent(this.data.roomId)}` });
    } catch (error) {
      wx.showToast({ title: '加入失败', icon: 'none' });
    } finally {
      this.setData({ joining: false });
    }
  },
});

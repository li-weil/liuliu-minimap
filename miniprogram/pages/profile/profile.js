const app = getApp();
const { syncUser } = require('../../services/user');

Page({
  data: {
    user: null,
    syncing: false,
  },

  onShow() {
    this.setData({ user: app.globalData.user });
  },

  async handleLogin() {
    this.setData({ syncing: true });
    try {
      const profile = await wx.getUserProfile({ desc: '用于同步你的漫步资料' });
      const result = await syncUser({
        nickName: profile.userInfo.nickName,
        avatarUrl: profile.userInfo.avatarUrl,
      });
      app.globalData.user = result.user;
      this.setData({ user: result.user });
      wx.showToast({ title: '登录成功', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: '登录失败', icon: 'none' });
    } finally {
      this.setData({ syncing: false });
    }
  },

  clearDraft() {
    app.clearWalkDraft();
    wx.showToast({ title: '草稿已清空', icon: 'success' });
  },
});

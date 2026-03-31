const app = getApp();
const { syncUser } = require('../../services/user');

function requestUserProfile() {
  return new Promise((resolve, reject) => {
    wx.getUserProfile({
      desc: '用于同步你的漫步资料',
      success: resolve,
      fail: reject,
    });
  });
}

function requestLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: resolve,
      fail: reject,
    });
  });
}

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
      const [profile, loginResult] = await Promise.all([
        requestUserProfile(),
        requestLoginCode(),
      ]);
      const code = loginResult && loginResult.code;
      if (!code) {
        throw new Error('wechat_login_code_missing');
      }
      const result = await syncUser({
        code,
        nickName: profile.userInfo.nickName,
        avatarUrl: profile.userInfo.avatarUrl,
      });
      app.globalData.user = result.user;
      wx.setStorageSync('citywalk_user', result.user || null);
      this.setData({ user: result.user });
      wx.showToast({ title: '登录成功', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: '登录失败', icon: 'none' });
    } finally {
      this.setData({ syncing: false });
    }
  },

  handleLogout() {
    wx.showModal({
      title: '退出当前账户',
      content: '退出后会清除本机保存的登录状态',
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        try {
          wx.removeStorageSync('citywalk_token');
          wx.removeStorageSync('citywalk_refresh_token');
          wx.removeStorageSync('citywalk_token_expires_in');
          wx.removeStorageSync('citywalk_user');
        } catch (error) {
          // Ignore storage cleanup failure and still reset in-memory user state.
        }

        app.globalData.user = null;
        this.setData({ user: null });
        wx.showToast({ title: '已退出登录', icon: 'success' });
      },
    });
  },

  clearDraft() {
    app.clearWalkDraft();
    wx.showToast({ title: '草稿已清空', icon: 'success' });
  },
});

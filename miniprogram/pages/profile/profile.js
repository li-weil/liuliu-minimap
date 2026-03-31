const app = getApp();
const { syncUser } = require('../../services/user');

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
    draftNickName: '',
    draftAvatarUrl: '',
  },

  onShow() {
    const user = this.normalizeUser(app.globalData.user);
    this.setData({
      user,
      draftNickName: user ? user.nickName : '',
      draftAvatarUrl: user ? user.avatarUrl : '',
    });
  },

  normalizeUser(user) {
    if (!user || typeof user !== 'object') {
      return null;
    }
    return {
      ...user,
      nickName: user.nickName || user.nickname || '微信用户',
      avatarUrl: user.avatarUrl || '',
    };
  },

  handleChooseAvatar(event) {
    const avatarUrl = event.detail && event.detail.avatarUrl ? event.detail.avatarUrl : '';
    if (!avatarUrl) {
      return;
    }
    this.setData({ draftAvatarUrl: avatarUrl });
  },

  handleNickNameInput(event) {
    this.setData({ draftNickName: event.detail.value || '' });
  },

  async handleLogin() {
    this.setData({ syncing: true });
    try {
      const nickName = (this.data.draftNickName || '').trim();
      const avatarUrl = this.data.draftAvatarUrl || '';
      if (!nickName) {
        throw new Error('nickname_required');
      }
      const loginResult = await requestLoginCode();
      const code = loginResult && loginResult.code;
      if (!code) {
        throw new Error('wechat_login_code_missing');
      }
      const result = await syncUser({
        code,
        nickName,
        avatarUrl,
      });
      const mergedUser = this.normalizeUser({
        ...(result.user || {}),
        nickName: (result.user && (result.user.nickName || result.user.nickname)) || nickName,
        avatarUrl: (result.user && result.user.avatarUrl) || avatarUrl,
      });
      app.globalData.user = mergedUser;
      wx.setStorageSync('citywalk_user', mergedUser || null);
      this.setData({ user: mergedUser });
      wx.showToast({ title: '登录成功', icon: 'success' });
    } catch (error) {
      wx.showToast({
        title: error && error.message === 'nickname_required' ? '先填写昵称' : '登录失败',
        icon: 'none',
      });
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
        this.setData({ user: null, draftNickName: '', draftAvatarUrl: '' });
        wx.showToast({ title: '已退出登录', icon: 'success' });
      },
    });
  },

  clearDraft() {
    app.clearWalkDraft();
    wx.showToast({ title: '草稿已清空', icon: 'success' });
  },
});

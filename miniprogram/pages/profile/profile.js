const app = getApp();
const { clearUserStorage, syncUser } = require('../../services/user');

Page({
  data: {
    user: null,
    syncing: false,
    draftNickName: '',
    draftAvatarUrl: '',
  },

  async onShow() {
    await app.ensureUserReady();
    const user = app.globalData.user;
    this.setData({
      user,
      draftNickName: user ? user.nickName : '',
      draftAvatarUrl: user ? user.avatarUrl : '',
    });
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
      const result = await syncUser({
        nickName,
        avatarUrl,
      });
      const mergedUser = app.setCurrentUser(result && result.user ? result.user : {
        nickName,
        avatarUrl,
      });
      this.setData({
        user: mergedUser,
        draftNickName: mergedUser ? mergedUser.nickName : nickName,
        draftAvatarUrl: mergedUser ? mergedUser.avatarUrl : avatarUrl,
      });
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
          clearUserStorage();
        } catch (error) {
          // Ignore storage cleanup failure and still reset in-memory user state.
        }

        app.clearCurrentUser();
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

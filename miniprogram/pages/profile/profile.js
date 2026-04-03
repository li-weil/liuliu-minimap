const app = getApp();
const { requestUpload } = require('../../services/api');
const { clearUserStorage, fetchCurrentUser, markManualLogout, syncUser } = require('../../services/user');
const {
  createDefaultPrivacyPopup,
  ensurePrivacyAuthorization,
  openPrivacyContract,
  rejectPrivacyAuthorization,
  resolvePrivacyAuthorization,
} = require('../../utils/privacy');

function explainProfileSaveFailure(error, fallbackTitle) {
  const message = String((error && error.message) || (error && error.errMsg) || '').toLowerCase();
  if (message.includes('nickname_required')) {
    return '先填写昵称';
  }
  if (message.includes('nickname_risky')) {
    return '昵称未通过安全校验，请换一个试试';
  }
  return fallbackTitle;
}

Page({
  data: {
    user: null,
    syncing: false,
    checkingAccount: false,
    draftNickName: '',
    draftAvatarUrl: '',
    pageMode: 'login',
    detectedUser: null,
    privacyPopup: createDefaultPrivacyPopup(),
  },

  async onShow() {
    await app.ensureUserReady();
    await this.syncPageUser();
  },

  resumePendingNavigation() {
    const target = app.consumePendingNavigation();
    if (!target || !target.url) {
      return false;
    }

    const navigate =
      target.mode === 'switchTab'
        ? wx.switchTab
        : target.mode === 'navigateTo'
          ? wx.navigateTo
          : wx.redirectTo;
    navigate({
      url: target.url,
      fail: () => {
        wx.reLaunch({ url: target.url });
      },
    });
    return true;
  },

  async syncPageUser() {
    const user = app.globalData.user;
    if (user) {
      this.setData({
        user,
        draftNickName: user.nickName || '',
        draftAvatarUrl: user.avatarUrl || '',
        pageMode: 'view',
        detectedUser: user,
      });
      return;
    }

    this.setData({
      user: null,
      draftNickName: '',
      draftAvatarUrl: '',
      pageMode: 'login',
      detectedUser: null,
    });

    await this.detectExistingAccount();
  },

  async detectExistingAccount() {
    if (this.data.checkingAccount || this.data.user) {
      return;
    }

    this.setData({ checkingAccount: true });
    try {
      const result = await fetchCurrentUser();
      if (result && result.loggedIn && result.user) {
        this.setData({
          draftNickName: result.user.nickName || '',
          draftAvatarUrl: result.user.avatarUrl || '',
          pageMode: 'login',
          detectedUser: result.user,
        });
      } else {
        this.setData({ pageMode: 'register', detectedUser: null });
      }
    } catch (error) {
      this.setData({ pageMode: 'register', detectedUser: null });
    } finally {
      this.setData({ checkingAccount: false });
    }
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

  async ensurePersistedAvatar(avatarUrl) {
    const normalized = String(avatarUrl || '').trim();
    if (!normalized) {
      return '';
    }
    if (normalized.startsWith('cloud://') || /^https?:\/\//i.test(normalized)) {
      return normalized;
    }
    return requestUpload(normalized, { kind: 'image' });
  },

  async handleQuickLogin() {
    this.setData({ syncing: true });
    try {
      const result = await fetchCurrentUser();
      const nextUser =
        (result && result.loggedIn && result.user) ||
        this.data.detectedUser ||
        null;
      if (!nextUser) {
        this.setData({ pageMode: 'register', detectedUser: null });
        throw new Error('profile_required');
      }
      const mergedUser = app.setCurrentUser(nextUser);
      this.setData({
        user: mergedUser,
        draftNickName: mergedUser ? mergedUser.nickName : '',
        draftAvatarUrl: mergedUser ? mergedUser.avatarUrl : '',
        pageMode: 'view',
        detectedUser: mergedUser,
      });
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(() => {
        this.resumePendingNavigation();
      }, 80);
    } catch (error) {
      wx.showToast({
        title: error && error.message === 'profile_required' ? '首次登录先设置资料' : '登录失败',
        icon: 'none',
      });
    } finally {
      this.setData({ syncing: false });
    }
  },

  async handleRegister() {
    this.setData({ syncing: true });
    try {
      await ensurePrivacyAuthorization(this, {
        title: '保存资料前说明',
        content: '昵称与头像将用于保存你的个人足迹，并在同行模式中向受邀队友展示你的身份。',
      });
      const nickName = (this.data.draftNickName || '').trim();
      const avatarUrl = await this.ensurePersistedAvatar(this.data.draftAvatarUrl || '');
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
        pageMode: 'view',
        detectedUser: mergedUser,
      });
      wx.showToast({ title: '登录成功', icon: 'success' });
      setTimeout(() => {
        this.resumePendingNavigation();
      }, 80);
    } catch (error) {
      if (error && error.message === 'privacy_authorization_denied') {
        wx.showToast({ title: '未同意隐私说明，暂时无法保存资料', icon: 'none' });
        return;
      }
      wx.showToast({ title: explainProfileSaveFailure(error, '登录失败'), icon: 'none' });
    } finally {
      this.setData({ syncing: false });
    }
  },

  startEditingProfile() {
    const user = this.data.user;
    this.setData({
      pageMode: 'edit',
      draftNickName: user ? user.nickName || '' : '',
      draftAvatarUrl: user ? user.avatarUrl || '' : '',
    });
  },

  enterRegisterMode() {
    this.setData({
      pageMode: 'register',
      draftNickName: '',
      draftAvatarUrl: '',
      detectedUser: null,
    });
  },

  async handleSaveProfile() {
    this.setData({ syncing: true });
    try {
      await ensurePrivacyAuthorization(this, {
        title: '保存资料前说明',
        content: '昵称与头像将用于保存你的个人足迹，并在同行模式中向受邀队友展示你的身份。',
      });
      const nickName = (this.data.draftNickName || '').trim();
      const avatarUrl = await this.ensurePersistedAvatar(this.data.draftAvatarUrl || '');
      if (!nickName) {
        throw new Error('nickname_required');
      }
      const result = await syncUser({ nickName, avatarUrl });
      const mergedUser = app.setCurrentUser(result && result.user ? result.user : {
        nickName,
        avatarUrl,
      });
      this.setData({
        user: mergedUser,
        draftNickName: mergedUser ? mergedUser.nickName : nickName,
        draftAvatarUrl: mergedUser ? mergedUser.avatarUrl : avatarUrl,
        pageMode: 'view',
        detectedUser: mergedUser,
      });
      wx.showToast({ title: '资料已更新', icon: 'success' });
    } catch (error) {
      if (error && error.message === 'privacy_authorization_denied') {
        wx.showToast({ title: '未同意隐私说明，暂时无法保存资料', icon: 'none' });
        return;
      }
      wx.showToast({ title: explainProfileSaveFailure(error, '保存失败'), icon: 'none' });
    } finally {
      this.setData({ syncing: false });
    }
  },

  handleLogout() {
    wx.showModal({
      title: '退出当前账户',
      content: '退出后会暂停自动登录，直到你下次手动点一次登录。',
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        try {
          clearUserStorage();
          markManualLogout();
        } catch (error) {
          // Ignore storage cleanup failure and still reset in-memory user state.
        }

        app.clearCurrentUser();
        this.setData({ user: null, draftNickName: '', draftAvatarUrl: '', pageMode: 'login', detectedUser: null });
        this.detectExistingAccount();
        wx.showToast({ title: '已退出登录', icon: 'success' });
      },
    });
  },

  resetDraftProfile() {
    if (this.data.user) {
      this.setData({
        draftNickName: this.data.user.nickName || '',
        draftAvatarUrl: this.data.user.avatarUrl || '',
        pageMode: 'view',
      });
      return;
    }

    this.setData({
      draftNickName: '',
      draftAvatarUrl: '',
      pageMode: this.data.detectedUser ? 'login' : 'register',
    });
  },

  clearDraft() {
    app.clearWalkDraft();
    wx.showToast({ title: '草稿已清空', icon: 'success' });
  },

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

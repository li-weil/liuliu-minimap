const { cloudEnvId, apiBaseUrl, useCloudMediaStorage, useCloudWalkStorage } = require('./utils/config');
const { loadDraft, saveDraft } = require('./utils/draft');
const {
  clearUserStorage,
  fetchCurrentUser,
  getStoredUser,
  isManualLogoutSuppressed,
  persistUser,
} = require('./services/user');

App({
  globalData: {
    user: null,
    walkDraft: loadDraft(),
    currentTheme: null,
    authReady: false,
  },

  onLaunch() {
    this.globalData.user = getStoredUser();

    if ((!apiBaseUrl || useCloudWalkStorage || useCloudMediaStorage) && wx.cloud) {
      wx.cloud.init({
        env: cloudEnvId,
        traceUser: true,
      });
    } else if (!apiBaseUrl && !wx.cloud) {
      console.error('wx.cloud is not available in current base library');
    }

    this.loadBrandFonts();
    this.userReadyPromise = this.bootstrapUser();
  },

  setWalkDraft(nextDraft) {
    this.globalData.walkDraft = nextDraft;
    saveDraft(nextDraft);
  },

  clearWalkDraft() {
    this.globalData.walkDraft = loadDraft(true);
    saveDraft(this.globalData.walkDraft);
  },

  setCurrentUser(user) {
    const nextUser = persistUser(user);
    this.globalData.user = nextUser;
    this.globalData.authReady = true;
    return nextUser;
  },

  clearCurrentUser() {
    clearUserStorage();
    this.globalData.user = null;
    this.globalData.authReady = true;
  },

  async bootstrapUser() {
    if (isManualLogoutSuppressed()) {
      this.globalData.authReady = true;
      return null;
    }

    try {
      const result = await fetchCurrentUser();
      if (result && result.loggedIn && result.user) {
        return this.setCurrentUser(result.user);
      }
      clearUserStorage();
      this.globalData.user = null;
      this.globalData.authReady = true;
      return null;
    } catch (error) {
      this.globalData.authReady = true;
      return this.globalData.user || null;
    }
  },

  ensureUserReady() {
    return this.userReadyPromise || Promise.resolve(this.globalData.user || null);
  },

  loadBrandFonts() {
    if (!wx.loadFontFace) {
      return;
    }

    [
      {
        family: 'ZCOOL KuaiLe',
        source: 'url("https://fonts.gstatic.com/s/zcoolkuaile/v22/tssqApdaRQokwFjFJjvM6h2Wpg.ttf")',
      },
      {
        family: 'ZCOOL XiaoWei',
        source: 'url("https://fonts.gstatic.com/s/zcoolxiaowei/v15/i7dMIFFrTRywPpUVX9_RJyM1YFI.ttf")',
      },
    ].forEach((font) => {
      wx.loadFontFace({
        family: font.family,
        source: font.source,
        global: true,
        success: () => {},
        fail: () => {},
      });
    });
  },
});

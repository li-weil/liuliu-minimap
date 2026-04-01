const { cloudEnvId, apiBaseUrl, useCloudMediaStorage, useCloudWalkStorage } = require('./utils/config');
const { loadDraft, saveDraft } = require('./utils/draft');
const { clearUserStorage, fetchCurrentUser, getStoredUser, hasLoginPreference, persistUser } = require('./services/user');

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
    if (!hasLoginPreference()) {
      this.globalData.authReady = true;
      return null;
    }

    try {
      const result = await fetchCurrentUser();
      if (result && result.loggedIn && result.user) {
        return this.setCurrentUser(result.user);
      }
      this.clearCurrentUser();
      return null;
    } catch (error) {
      this.globalData.authReady = true;
      return this.globalData.user || null;
    }
  },

  ensureUserReady() {
    return this.userReadyPromise || Promise.resolve(this.globalData.user || null);
  },
});

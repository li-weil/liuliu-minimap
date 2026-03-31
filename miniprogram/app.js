const { cloudEnvId, apiBaseUrl } = require('./utils/config');
const { loadDraft, saveDraft } = require('./utils/draft');

App({
  globalData: {
    user: null,
    walkDraft: loadDraft(),
    currentTheme: null,
  },

  onLaunch() {
    try {
      this.globalData.user = wx.getStorageSync('citywalk_user') || null;
    } catch (error) {
      this.globalData.user = null;
    }

    if (!apiBaseUrl && wx.cloud) {
      wx.cloud.init({
        env: cloudEnvId,
        traceUser: true,
      });
      return;
    }

    if (!apiBaseUrl && !wx.cloud) {
      console.error('wx.cloud is not available in current base library');
    }
  },

  setWalkDraft(nextDraft) {
    this.globalData.walkDraft = nextDraft;
    saveDraft(nextDraft);
  },

  clearWalkDraft() {
    this.globalData.walkDraft = loadDraft(true);
    saveDraft(this.globalData.walkDraft);
  },
});

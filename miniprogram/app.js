const {
  cloudEnvId,
  apiBaseUrl,
  brandFontBaseUrl,
  useCloudMediaStorage,
  useCloudWalkStorage,
} = require('./utils/config');
const { getDefaultDraft, loadDraftStore, removeDraft, saveDraft } = require('./utils/draft');
const { listMyTeamWalks } = require('./services/team');
const { listMyWalks } = require('./services/walk');
const {
  clearUserStorage,
  fetchCurrentUser,
  getStoredUser,
  isManualLogoutSuppressed,
  persistUser,
} = require('./services/user');

const PENDING_NAVIGATION_KEY = 'pending_navigation_target_v1';

function buildBrandFontSource(filename) {
  const baseUrl = String(brandFontBaseUrl || '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    return '';
  }
  return `url("${baseUrl}/${filename}")`;
}

App({
  globalData: {
    user: null,
    activeWalkId: '',
    walkDraft: getDefaultDraft(),
    walkDrafts: {},
    currentTheme: null,
    achievementSnapshot: null,
    authReady: false,
    pendingNavigation: null,
    activeTeamReminderShown: false,
  },

  onLaunch() {
    const draftStore = loadDraftStore();
    const activeWalkId = draftStore.activeWalkId || '';
    this.globalData.user = getStoredUser();
    this.globalData.activeWalkId = activeWalkId;
    this.globalData.walkDrafts = draftStore.drafts || {};
    this.globalData.walkDraft = activeWalkId && this.globalData.walkDrafts[activeWalkId]
      ? this.globalData.walkDrafts[activeWalkId]
      : getDefaultDraft();
    this.globalData.pendingNavigation = this.getPendingNavigation();

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
    setTimeout(() => {
      this.checkActiveWalkReminder();
    }, 800);
  },

  setWalkDraft(nextDraft, walkId = '') {
    const nextWalkId = walkId || this.globalData.activeWalkId || (nextDraft && nextDraft.walkId) || '';
    const normalizedDraft = {
      ...getDefaultDraft(),
      ...(nextDraft || {}),
      walkId: nextWalkId,
    };
    this.globalData.activeWalkId = nextWalkId;
    this.globalData.walkDraft = normalizedDraft;
    this.globalData.walkDrafts = {
      ...(this.globalData.walkDrafts || {}),
      ...(nextWalkId ? { [nextWalkId]: normalizedDraft } : {}),
    };
    if (nextWalkId) {
      saveDraft(normalizedDraft, nextWalkId);
    }
  },

  activateWalkDraft(walkId) {
    if (!walkId) {
      this.globalData.activeWalkId = '';
      this.globalData.walkDraft = getDefaultDraft();
      return this.globalData.walkDraft;
    }
    const walkDraft = (this.globalData.walkDrafts && this.globalData.walkDrafts[walkId]) || null;
    if (walkDraft) {
      this.globalData.activeWalkId = walkId;
      this.globalData.walkDraft = walkDraft;
      return walkDraft;
    }
    const fallbackDraft = {
      ...getDefaultDraft(),
      walkId,
    };
    this.globalData.activeWalkId = walkId;
    this.globalData.walkDraft = fallbackDraft;
    return fallbackDraft;
  },

  getWalkDraft(walkId) {
    if (!walkId) {
      return this.globalData.walkDraft || getDefaultDraft();
    }
    return (this.globalData.walkDrafts && this.globalData.walkDrafts[walkId]) || null;
  },

  clearWalkDraft(walkId = '') {
    if (!walkId) {
      Object.keys(this.globalData.walkDrafts || {}).forEach((id) => {
        removeDraft(id);
      });
      this.globalData.activeWalkId = '';
      this.globalData.walkDrafts = {};
      this.globalData.walkDraft = getDefaultDraft();
      return;
    }
    removeDraft(walkId);
    const nextDrafts = { ...(this.globalData.walkDrafts || {}) };
    delete nextDrafts[walkId];
    this.globalData.walkDrafts = nextDrafts;
    if (this.globalData.activeWalkId === walkId) {
      this.globalData.activeWalkId = '';
      this.globalData.walkDraft = getDefaultDraft();
    }
  },

  setPendingNavigation(target) {
    const nextTarget = target && typeof target === 'object'
      ? {
          url: target.url || '',
          mode: target.mode || 'redirect',
        }
      : null;
    this.globalData.pendingNavigation = nextTarget;
    try {
      if (nextTarget && nextTarget.url) {
        wx.setStorageSync(PENDING_NAVIGATION_KEY, nextTarget);
      } else {
        wx.removeStorageSync(PENDING_NAVIGATION_KEY);
      }
    } catch (error) {
      // Ignore storage failure and still keep in-memory state.
    }
    return nextTarget;
  },

  getPendingNavigation() {
    if (this.globalData.pendingNavigation && this.globalData.pendingNavigation.url) {
      return this.globalData.pendingNavigation;
    }
    try {
      const stored = wx.getStorageSync(PENDING_NAVIGATION_KEY);
      return stored && typeof stored === 'object' && stored.url ? stored : null;
    } catch (error) {
      return null;
    }
  },

  consumePendingNavigation() {
    const target = this.getPendingNavigation();
    this.setPendingNavigation(null);
    return target;
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

  async checkActiveWalkReminder() {
    if (this.globalData.activeTeamReminderShown) {
      return;
    }

    try {
      await this.ensureUserReady();
      if (!this.globalData.user) {
        return;
      }
      const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
      const currentRoute = pages.length ? pages[pages.length - 1].route || '' : '';
      if (currentRoute.indexOf('pages/team-') === 0 || currentRoute === 'pages/record/record' || currentRoute === 'pages/walk-detail/walk-detail') {
        return;
      }
      const [teamResult, soloResult] = await Promise.all([
        listMyTeamWalks({ limit: 10 }),
        listMyWalks({ limit: 10 }),
      ]);
      const hasActiveTeamWalk = Array.isArray(teamResult.records) && teamResult.records.some((item) => item && item.status === 'active');
      const hasActiveSoloWalk = Array.isArray(soloResult.records) && soloResult.records.some((item) => item && item.status === 'active');
      if (!hasActiveTeamWalk && !hasActiveSoloWalk) {
        return;
      }
      this.globalData.activeTeamReminderShown = true;
      wx.showModal({
        title: '你还有进行中的漫步',
        content: '请前往“足迹 - 纪念卡册”，打开显示“进行中”的记录详情页，再点击“继续记录这次漫步”或“重新进入这场同行”继续任务。',
        showCancel: false,
        confirmText: '知道了',
      });
    } catch (error) {
      // Ignore reminder failure to avoid blocking app startup.
    }
  },

  loadBrandFonts() {
    if (!wx.loadFontFace) {
      return;
    }

    const fonts = [
      {
        family: 'ZCOOL KuaiLe',
        source: buildBrandFontSource('zcool-kuaile.ttf'),
      },
      {
        family: 'ZCOOL XiaoWei',
        source: buildBrandFontSource('zcool-xiaowei.ttf'),
      },
    ].filter((font) => font.source);

    fonts.forEach((font) => {
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

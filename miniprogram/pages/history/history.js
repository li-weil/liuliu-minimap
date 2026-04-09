const app = getApp();
const { listMyWalks } = require('../../services/walk');
const { listMyTeamWalks } = require('../../services/team');
const { listMyAchievements } = require('../../services/achievement');
const { hydrateAchievementAssets } = require('../../services/asset');
const { isManualLogoutSuppressed } = require('../../services/user');
const { formatDate } = require('../../utils/format');
const {
  ACHIEVEMENT_STORAGE_KEY,
  FEATURED_ACHIEVEMENT_STORAGE_KEY,
} = require('../../utils/achievements');

function readAchievementState() {
  try {
    return wx.getStorageSync(ACHIEVEMENT_STORAGE_KEY) || {};
  } catch (error) {
    return {};
  }
}

function persistAchievementState(state) {
  try {
    wx.setStorageSync(ACHIEVEMENT_STORAGE_KEY, state);
  } catch (error) {
    // Ignore storage failures and keep the page state as source of truth.
  }
}

function readFeaturedAchievementId() {
  try {
    return wx.getStorageSync(FEATURED_ACHIEVEMENT_STORAGE_KEY) || '';
  } catch (error) {
    return '';
  }
}

function resolveWalkSortTimestamp(item) {
  if (!item || typeof item !== 'object') {
    return 0;
  }
  if (item.status === 'finished') {
    return Number(item.endedAt || item.createdAt || 0);
  }
  return Number(item.createdAt || 0);
}

function buildHistoryShareTitle(data = {}) {
  const user = data.user || null;
  if (user && user.nickName) {
    return `遛遛 | ${user.nickName} 邀你一起 citywalk`;
  }

  return '遛遛 | 邀你一起 citywalk';
}

Page({
  data: {
    activeTab: 'album',
    user: null,
    walks: [],
    achievements: [],
    achievementSummary: {
      unlockedCount: 0,
      totalCount: 0,
      completionRate: 0,
    },
    featuredAchievement: null,
    loading: false,
    loginState: 'ready',
  },

  async onShow() {
    await app.ensureUserReady();
    const user = app.globalData.user || null;
    this.setData({
      user,
      loginState: user ? 'ready' : (isManualLogoutSuppressed() ? 'paused' : 'register'),
    });
    if (!user) {
      app.globalData.achievementSnapshot = null;
      this.setData({
        walks: [],
        achievements: [],
        achievementSummary: {
          unlockedCount: 0,
          totalCount: 0,
          completionRate: 0,
        },
        featuredAchievement: null,
        loading: false,
      });
      return;
    }
    this.fetchWalks();
  },

  onShareAppMessage() {
    return {
      title: buildHistoryShareTitle(this.data),
      path: '/pages/history/history',
    };
  },

  onShareTimeline() {
    return {
      title: buildHistoryShareTitle(this.data),
      query: '',
    };
  },

  async fetchWalks() {
    this.setData({ loading: true });
    try {
      const [soloResult, teamResult, achievementResult] = await Promise.all([
        listMyWalks({ limit: 20 }),
        listMyTeamWalks({ limit: 20 }),
        listMyAchievements(),
      ]);
      const walks = [...(soloResult.records || []), ...(teamResult.records || [])]
        .map((item) => ({
          ...item,
          createdAtLabel: formatDate(item.createdAt),
        }))
        .sort((left, right) => resolveWalkSortTimestamp(right) - resolveWalkSortTimestamp(left));
      const achievements = await hydrateAchievementAssets(achievementResult.achievements || []);
      const featuredAchievement = this.resolveFeaturedAchievement(achievements);
      app.globalData.achievementSnapshot = {
        achievements,
        summary: achievementResult.summary || {
          unlockedCount: 0,
          totalCount: achievements.length,
          completionRate: 0,
        },
        updatedAt: Date.now(),
      };
      this.setData({
        walks,
        achievements,
        achievementSummary: achievementResult.summary || {
          unlockedCount: 0,
          totalCount: achievements.length,
          completionRate: 0,
        },
        featuredAchievement,
      });
      this.notifyNewAchievements(achievements);
    } catch (error) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  notifyNewAchievements(achievements) {
    const previousState = readAchievementState();
    const previousUnlockedIds = new Set(previousState.unlockedIds || []);
    const unlockedAchievements = (achievements || []).filter((item) => item.unlocked);
    const nextUnlockedIds = unlockedAchievements.map((item) => item.id);
    const newlyUnlocked = unlockedAchievements.filter((item) => !previousUnlockedIds.has(item.id));

    persistAchievementState({
      unlockedIds: nextUnlockedIds,
      updatedAt: Date.now(),
    });

    if (!newlyUnlocked.length) {
      return;
    }

    const title = newlyUnlocked.length === 1
      ? `解锁新成就：${newlyUnlocked[0].title}`
      : `新解锁 ${newlyUnlocked.length} 项成就`;
    wx.showToast({
      title: title.slice(0, 20),
      icon: 'none',
      duration: 2200,
    });
  },

  resolveFeaturedAchievement(achievements) {
    const featuredId = readFeaturedAchievementId();
    const list = Array.isArray(achievements) ? achievements : [];
    const featuredAchievement = list.find((item) => item.id === featuredId && item.unlocked);
    if (featuredAchievement) {
      return featuredAchievement;
    }
    return list.find((item) => item.unlocked) || null;
  },

  openDetail(event) {
    const id = event.detail.id;
    const recordType = event.detail.recordType || 'solo';
    if (!id) {
      return;
    }
    if (recordType === 'team') {
      wx.navigateTo({ url: `/pages/team-detail/team-detail?roomId=${id}` });
      return;
    }
    wx.navigateTo({ url: `/pages/walk-detail/walk-detail?id=${id}&source=history` });
  },

  switchTab(event) {
    this.setData({ activeTab: event.currentTarget.dataset.tab });
  },

  openAchievementDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) {
      return;
    }
    wx.navigateTo({
      url: `/pages/achievement-detail/achievement-detail?id=${encodeURIComponent(id)}`,
    });
  },

  handleAchievementImageError(event) {
    const achievementId = event.currentTarget.dataset.id;
    if (!achievementId) {
      return;
    }

    const achievements = (this.data.achievements || []).map((item) => (
      item.id === achievementId
        ? {
          ...item,
          asset: '',
        }
        : item
    ));
    this.setData({ achievements });
  },

  handleFeaturedAchievementImageError() {
    const featuredAchievement = this.data.featuredAchievement;
    if (!featuredAchievement) {
      return;
    }
    this.setData({
      featuredAchievement: {
        ...featuredAchievement,
        asset: '',
      },
    });
  },

  goToProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },
});

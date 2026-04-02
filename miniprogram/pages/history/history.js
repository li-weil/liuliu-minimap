const app = getApp();
const { listMyWalks } = require('../../services/walk');
const { listMyTeamWalks } = require('../../services/team');
const { computeAchievements } = require('../../services/achievement');
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

function isCloudFileId(value) {
  return typeof value === 'string' && value.indexOf('cloud://') === 0;
}

function readFeaturedAchievementId() {
  try {
    return wx.getStorageSync(FEATURED_ACHIEVEMENT_STORAGE_KEY) || '';
  } catch (error) {
    return '';
  }
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

  async fetchWalks() {
    this.setData({ loading: true });
    try {
      const [soloResult, teamResult] = await Promise.all([
        listMyWalks({ limit: 20 }),
        listMyTeamWalks({ limit: 20 }),
      ]);
      const walks = [...(soloResult.records || []), ...(teamResult.records || [])]
        .map((item) => ({
          ...item,
          createdAtLabel: formatDate(item.createdAt),
        }))
        .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
      const achievementResult = computeAchievements(walks);
      const achievements = await this.resolveAchievementAssets(achievementResult.achievements);
      const featuredAchievement = this.resolveFeaturedAchievement(achievements);
      this.setData({
        walks,
        achievements,
        achievementSummary: achievementResult.summary,
        featuredAchievement,
      });
      this.notifyNewAchievements(achievements);
    } catch (error) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async resolveAchievementAssets(achievements) {
    const list = Array.isArray(achievements) ? achievements : [];
    const cloudFileIds = Array.from(new Set(
      list
        .map((item) => item.asset)
        .filter((asset) => isCloudFileId(asset))
    ));

    if (!cloudFileIds.length || !wx.cloud || !wx.cloud.getTempFileURL) {
      return list.map((item) => ({
        ...item,
        assetUrl: item.asset || '',
      }));
    }

    try {
      const result = await wx.cloud.getTempFileURL({ fileList: cloudFileIds });
      const fileMap = (result.fileList || []).reduce((accumulator, file) => {
        accumulator[file.fileID] = file.tempFileURL || '';
        return accumulator;
      }, {});

      return list.map((item) => ({
        ...item,
        assetUrl: isCloudFileId(item.asset) ? (fileMap[item.asset] || '') : (item.asset || ''),
      }));
    } catch (error) {
      return list.map((item) => ({
        ...item,
        assetUrl: isCloudFileId(item.asset) ? '' : (item.asset || ''),
      }));
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
          assetUrl: '',
        }
        : item
    ));
    this.setData({ achievements });
  },

  goToProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },
});

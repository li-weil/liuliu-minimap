const app = getApp();
const { listMyAchievements } = require('../../services/achievement');
const { hydrateAchievementAssets } = require('../../services/asset');
const {
  FEATURED_ACHIEVEMENT_STORAGE_KEY,
} = require('../../utils/achievements');

Page({
  data: {
    loading: true,
    achievement: null,
    shareTitle: '我的城市漫步成就',
    featuredAchievementId: '',
  },

  async onLoad(query) {
    this.achievementId = query.id || '';
    this.syncFeaturedAchievement();
    await this.loadAchievement();
  },

  onShow() {
    this.syncFeaturedAchievement();
  },

  onShareAppMessage() {
    const achievement = this.data.achievement;
    const user = app.globalData.user || null;
    const shareTitle = user && user.nickName
      ? `遛遛 | ${user.nickName} 邀你一起 citywalk`
      : '遛遛 | 邀你一起 citywalk';
    return {
      title: shareTitle,
      path: achievement
        ? `/pages/achievement-detail/achievement-detail?id=${encodeURIComponent(achievement.id)}`
        : '/pages/history/history',
      imageUrl: achievement && achievement.asset ? achievement.asset : '',
    };
  },

  onShareTimeline() {
    const achievement = this.data.achievement;
    const user = app.globalData.user || null;
    const shareTitle = user && user.nickName
      ? `遛遛 | ${user.nickName} 邀你一起 citywalk`
      : '遛遛 | 邀你一起 citywalk';
    return {
      title: shareTitle,
      query: achievement ? `id=${encodeURIComponent(achievement.id)}` : '',
      imageUrl: achievement && achievement.asset ? achievement.asset : '',
    };
  },

  syncFeaturedAchievement() {
    try {
      this.setData({
        featuredAchievementId: wx.getStorageSync(FEATURED_ACHIEVEMENT_STORAGE_KEY) || '',
      });
    } catch (error) {
      this.setData({ featuredAchievementId: '' });
    }
  },

  async loadAchievement() {
    if (!this.achievementId) {
      this.setData({ loading: false, achievement: null });
      return;
    }

    const snapshot = app.globalData.achievementSnapshot;
    if (snapshot && Array.isArray(snapshot.achievements)) {
      const cachedAchievement = snapshot.achievements.find((item) => item.id === this.achievementId) || null;
      this.setData({
        loading: false,
        achievement: cachedAchievement,
        shareTitle: cachedAchievement ? `${cachedAchievement.title}｜我的城市漫步成就` : '我的城市漫步成就',
      });
      return;
    }

    this.setData({ loading: true });
    try {
      await app.ensureUserReady();
      const achievementResult = await listMyAchievements();
      const achievements = await hydrateAchievementAssets(achievementResult.achievements || []);
      const resolvedAchievement = achievements.find((item) => item.id === this.achievementId) || null;
      app.globalData.achievementSnapshot = {
        achievements,
        summary: achievementResult.summary,
        updatedAt: Date.now(),
      };
      this.setData({
        achievement: resolvedAchievement,
        shareTitle: resolvedAchievement ? `${resolvedAchievement.title}｜我的城市漫步成就` : '我的城市漫步成就',
      });
    } catch (error) {
      wx.showToast({ title: '成就加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  handleSetFeatured() {
    const achievement = this.data.achievement;
    if (!achievement || !achievement.unlocked) {
      wx.showToast({ title: '解锁后才能展示', icon: 'none' });
      return;
    }

    try {
      wx.setStorageSync(FEATURED_ACHIEVEMENT_STORAGE_KEY, achievement.id);
      this.setData({ featuredAchievementId: achievement.id });
      wx.showToast({ title: '已设为展示成就', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: '设置失败', icon: 'none' });
    }
  },

  handleImageError() {
    const achievement = this.data.achievement;
    if (!achievement) {
      return;
    }
    this.setData({
      achievement: {
        ...achievement,
        asset: '',
      },
    });
  },
});

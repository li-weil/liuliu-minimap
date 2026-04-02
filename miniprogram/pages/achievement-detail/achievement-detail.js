const app = getApp();
const { listMyWalks } = require('../../services/walk');
const { listMyTeamWalks } = require('../../services/team');
const { computeAchievements } = require('../../services/achievement');
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
    return {
      title: achievement
        ? `${achievement.title}｜${achievement.description}`
        : this.data.shareTitle,
      path: achievement
        ? `/pages/achievement-detail/achievement-detail?id=${encodeURIComponent(achievement.id)}`
        : '/pages/history/history',
      imageUrl: achievement && achievement.asset ? achievement.asset : '',
    };
  },

  onShareTimeline() {
    const achievement = this.data.achievement;
    return {
      title: achievement
        ? `${achievement.title}｜我的城市漫步成就`
        : this.data.shareTitle,
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

    this.setData({ loading: true });
    try {
      await app.ensureUserReady();
      const [soloResult, teamResult] = await Promise.all([
        listMyWalks({ limit: 50 }),
        listMyTeamWalks({ limit: 50 }),
      ]);
      const records = [...(soloResult.records || []), ...(teamResult.records || [])];
      const achievementResult = computeAchievements(records);
      const resolvedAchievement = (achievementResult.achievements || []).find((item) => item.id === this.achievementId) || null;
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

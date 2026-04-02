const app = getApp();
const { listMyWalks } = require('../../services/walk');
const { listMyTeamWalks } = require('../../services/team');
const { isManualLogoutSuppressed } = require('../../services/user');
const { formatDate } = require('../../utils/format');

Page({
  data: {
    activeTab: 'album',
    user: null,
    walks: [],
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
      this.setData({ walks: [], loading: false });
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
      this.setData({ walks });
    } catch (error) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
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

  goToProfile() {
    wx.switchTab({ url: '/pages/profile/profile' });
  },
});

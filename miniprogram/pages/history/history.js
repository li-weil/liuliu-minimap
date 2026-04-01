const app = getApp();
const { listMyWalks } = require('../../services/walk');
const { formatDate } = require('../../utils/format');

Page({
  data: {
    activeTab: 'album',
    user: null,
    walks: [],
    loading: false,
  },

  async onShow() {
    await app.ensureUserReady();
    const user = app.globalData.user || null;
    this.setData({ user });
    if (!user) {
      this.setData({ walks: [], loading: false });
      return;
    }
    this.fetchWalks();
  },

  async fetchWalks() {
    this.setData({ loading: true });
    try {
      const result = await listMyWalks({ limit: 20 });
      const walks = (result.records || []).map((item) => ({
        ...item,
        createdAtLabel: formatDate(item.createdAt),
      }));
      this.setData({ walks });
    } catch (error) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  openDetail(event) {
    const id = event.detail.id;
    if (!id) {
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

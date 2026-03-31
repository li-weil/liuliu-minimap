const { getWalkDetail } = require('../../services/walk');
const { formatDate } = require('../../utils/format');

Page({
  data: {
    loading: true,
    source: 'history',
    walk: null,
  },

  onLoad(query) {
    this.setData({ source: query.source || 'history' });
    if (query.id) {
      this.fetchDetail(query.id);
    } else {
      this.setData({ loading: false });
    }
  },

  async fetchDetail(id) {
    this.setData({ loading: true });
    try {
      const result = await getWalkDetail({ id });
      const walk = result.walk
        ? {
            ...result.walk,
            createdAtLabel: formatDate(result.walk.createdAt),
            missionItems: ((result.walk.themeSnapshot && result.walk.themeSnapshot.missions) || []).map((mission) => ({
              mission,
              review: result.walk.missionReviews && result.walk.missionReviews[mission] ? result.walk.missionReviews[mission] : null,
              assets: result.walk.missionAssetMap && result.walk.missionAssetMap[mission] ? result.walk.missionAssetMap[mission] : null,
            })),
          }
        : null;
      this.setData({ walk });
    } catch (error) {
      wx.showToast({ title: '详情加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});

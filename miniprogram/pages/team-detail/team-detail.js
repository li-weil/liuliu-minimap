const { getTeamWalkDetail } = require('../../services/team');
const { formatDate } = require('../../utils/format');

function buildMissionGroups(room) {
  const missions = Array.isArray(room && room.themeSnapshot && room.themeSnapshot.missions)
    ? room.themeSnapshot.missions
    : [];
  const contributions = Array.isArray(room && room.contributions) ? room.contributions : [];
  return missions.map((mission) => ({
    mission,
    completed: contributions.some((item) => item.missionKey === mission && item.completed),
    completedLabel: contributions.some((item) => item.missionKey === mission && item.completed) ? '团队已点亮' : '仍待完成',
    contributions: contributions.filter((item) => item.missionKey === mission),
  }));
}

Page({
  data: {
    loading: true,
    roomId: '',
    room: null,
    missionGroups: [],
    statusLabel: '进行中',
    locationContextLabel: '城市街道',
  },

  onLoad(query) {
    this.setData({ roomId: query.roomId || query.id || '' });
    this.fetchDetail();
  },

  onShareAppMessage() {
    const room = this.data.room;
    return {
      title: room ? `${room.themeTitle}｜我们的同行漫步` : '我们的同行漫步',
      path: `/pages/team-detail/team-detail?roomId=${encodeURIComponent(this.data.roomId)}`,
      imageUrl: room && room.coverImage ? room.coverImage : '',
    };
  },

  async fetchDetail() {
    if (!this.data.roomId) {
      this.setData({ loading: false, room: null });
      return;
    }
    this.setData({ loading: true });
    try {
      const result = await getTeamWalkDetail({ roomId: this.data.roomId });
      const room = result.room || null;
      this.setData({
        room: room ? { ...room, createdAtLabel: formatDate(room.createdAt) } : null,
        missionGroups: buildMissionGroups(room || {}),
        statusLabel: room && room.status === 'finished' ? '已结束' : '进行中',
        locationContextLabel: room && room.locationContext ? room.locationContext : '城市街道',
      });
    } catch (error) {
      wx.showToast({ title: '详情加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});

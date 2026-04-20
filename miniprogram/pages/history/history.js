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

const ALBUM_STATUS_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待出发' },
  { key: 'active', label: '进行中' },
  { key: 'finished', label: '已完成' },
];

const ALBUM_TYPE_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'solo', label: '单人' },
  { key: 'team', label: '同行' },
];

function normalizeAlbumStatus(item) {
  if (!item || typeof item !== 'object') {
    return 'pending';
  }

  const status = String(item.status || '').toLowerCase();
  if (status === 'waiting' || status === 'pending') {
    return 'pending';
  }
  if (status === 'active') {
    return 'active';
  }
  if (status === 'finished') {
    return 'finished';
  }

  if (item.endedAt) {
    return 'finished';
  }
  if (item.startedAt) {
    return 'active';
  }
  return item.recordType === 'team' ? 'pending' : 'active';
}

function getAlbumStatusLabel(statusKey) {
  const matched = ALBUM_STATUS_OPTIONS.find((item) => item.key === statusKey);
  return matched ? matched.label : '待出发';
}

function normalizeAlbumRecordType(item) {
  return item && item.recordType === 'team' ? 'team' : 'solo';
}

function getAlbumTypeLabel(typeKey) {
  const matched = ALBUM_TYPE_OPTIONS.find((item) => item.key === typeKey);
  return matched ? matched.label : '全部';
}

function buildAlbumStatusCounts(walks = [], typeFilter = 'all') {
  const scopedWalks = typeFilter === 'all'
    ? walks
    : walks.filter((item) => normalizeAlbumRecordType(item) === typeFilter);
  return scopedWalks.reduce((result, item) => {
    const statusKey = item && item.albumStatusKey ? item.albumStatusKey : normalizeAlbumStatus(item);
    return {
      ...result,
      all: result.all + 1,
      [statusKey]: (result[statusKey] || 0) + 1,
    };
  }, {
    all: 0,
    pending: 0,
    active: 0,
    finished: 0,
  });
}

function buildAlbumStatusChips(counts = {}) {
  return ALBUM_STATUS_OPTIONS.map((item) => ({
    ...item,
    count: Number(counts[item.key] || 0),
  }));
}

function buildAlbumTypeCounts(walks = [], statusFilter = 'all') {
  const scopedWalks = statusFilter === 'all'
    ? walks
    : walks.filter((item) => {
      const statusKey = item && item.albumStatusKey ? item.albumStatusKey : normalizeAlbumStatus(item);
      return statusKey === statusFilter;
    });
  return scopedWalks.reduce((result, item) => {
    const typeKey = normalizeAlbumRecordType(item);
    return {
      ...result,
      all: result.all + 1,
      [typeKey]: (result[typeKey] || 0) + 1,
    };
  }, {
    all: 0,
    solo: 0,
    team: 0,
  });
}

function buildAlbumTypeChips(counts = {}) {
  return ALBUM_TYPE_OPTIONS.map((item) => ({
    ...item,
    count: Number(counts[item.key] || 0),
  }));
}

function buildAlbumEmptyState(statusKey, typeKey) {
  if (statusKey === 'all' && typeKey === 'all') {
    return {
      title: '纪念卡册',
      subtitle: '这里会放 AI 根据一次漫步内容生成的纪念卡，当前先留空。',
    };
  }
  const statusLabel = statusKey === 'all' ? '全部状态' : getAlbumStatusLabel(statusKey);
  const typeLabel = typeKey === 'all' ? '全部类型' : getAlbumTypeLabel(typeKey);
  const titlePrefix = [
    typeKey === 'all' ? '' : typeLabel,
    statusKey === 'all' ? '' : statusLabel,
  ].join('');
  return {
    title: `${titlePrefix || '纪念卡册'}记录`,
    subtitle: `暂时还没有${titlePrefix || '对应筛选条件下'}的漫步记录。`,
  };
}

function buildAlbumFilterSummary(statusKey, typeKey) {
  const statusLabel = statusKey === 'all' ? '' : getAlbumStatusLabel(statusKey);
  const typeLabel = typeKey === 'all' ? '' : getAlbumTypeLabel(typeKey);
  const parts = [typeLabel, statusLabel].filter(Boolean);
  return parts.length ? parts.join(' · ') : '全部记录';
}

function buildAlbumResultCountLabel(count) {
  return `当前 ${Number(count || 0)} 条记录`;
}

function buildRecentAchievements(achievements = []) {
  const unlocked = (Array.isArray(achievements) ? achievements : []).filter((item) => item && item.unlocked);
  return unlocked.slice(0, 3);
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
    allWalks: [],
    walks: [],
    albumStatusFilter: 'all',
    albumTypeFilter: 'all',
    albumStatusChips: buildAlbumStatusChips(),
    albumTypeChips: buildAlbumTypeChips(),
    albumEmptyTitle: buildAlbumEmptyState('all', 'all').title,
    albumEmptySubtitle: buildAlbumEmptyState('all', 'all').subtitle,
    albumFilterSummary: buildAlbumFilterSummary('all', 'all'),
    albumFilterExpanded: false,
    albumResultCountLabel: buildAlbumResultCountLabel(0),
    albumStatusCounts: {
      all: 0,
      pending: 0,
      active: 0,
      finished: 0,
    },
    albumTypeCounts: {
      all: 0,
      solo: 0,
      team: 0,
    },
    achievements: [],
    recentAchievements: [],
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
        allWalks: [],
        walks: [],
        albumStatusChips: buildAlbumStatusChips(),
        albumTypeChips: buildAlbumTypeChips(),
        albumEmptyTitle: buildAlbumEmptyState(this.data.albumStatusFilter || 'all', this.data.albumTypeFilter || 'all').title,
        albumEmptySubtitle: buildAlbumEmptyState(this.data.albumStatusFilter || 'all', this.data.albumTypeFilter || 'all').subtitle,
        albumFilterSummary: buildAlbumFilterSummary(this.data.albumStatusFilter || 'all', this.data.albumTypeFilter || 'all'),
        albumResultCountLabel: buildAlbumResultCountLabel(0),
        albumStatusCounts: buildAlbumStatusCounts([], this.data.albumTypeFilter || 'all'),
        albumTypeCounts: buildAlbumTypeCounts([], this.data.albumStatusFilter || 'all'),
        achievements: [],
        recentAchievements: [],
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
        .map((item) => {
          const albumStatusKey = normalizeAlbumStatus(item);
          return {
            ...item,
            createdAtLabel: formatDate(item.createdAt),
            albumStatusKey,
            albumStatusLabel: getAlbumStatusLabel(albumStatusKey),
          };
        })
        .sort((left, right) => resolveWalkSortTimestamp(right) - resolveWalkSortTimestamp(left));
      const albumStatusCounts = buildAlbumStatusCounts(walks, this.data.albumTypeFilter || 'all');
      const albumTypeCounts = buildAlbumTypeCounts(walks, this.data.albumStatusFilter || 'all');
      const achievements = await hydrateAchievementAssets(achievementResult.achievements || []);
      const featuredAchievement = this.resolveFeaturedAchievement(achievements);
      const recentAchievements = buildRecentAchievements(achievements);
      app.globalData.achievementSnapshot = {
        achievements,
        recentAchievements,
        summary: achievementResult.summary || {
          unlockedCount: 0,
          totalCount: achievements.length,
          completionRate: 0,
        },
        updatedAt: Date.now(),
      };
      this.setData({
        allWalks: walks,
        albumStatusCounts,
        albumStatusChips: buildAlbumStatusChips(albumStatusCounts),
        albumTypeCounts,
        albumTypeChips: buildAlbumTypeChips(albumTypeCounts),
        achievements,
        achievementSummary: achievementResult.summary || {
          unlockedCount: 0,
          totalCount: achievements.length,
          completionRate: 0,
        },
        featuredAchievement,
      }, () => {
        this.applyWalkFilter();
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

  switchAlbumStatus(event) {
    const nextFilter = event.currentTarget.dataset.status;
    if (!nextFilter || nextFilter === this.data.albumStatusFilter) {
      return;
    }
    this.setData({
      albumStatusFilter: nextFilter,
    }, () => {
      this.applyWalkFilter();
    });
  },

  switchAlbumType(event) {
    const nextFilter = event.currentTarget.dataset.type;
    if (!nextFilter || nextFilter === this.data.albumTypeFilter) {
      return;
    }
    this.setData({
      albumTypeFilter: nextFilter,
    }, () => {
      this.applyWalkFilter();
    });
  },

  resetAlbumFilters() {
    if (this.data.albumStatusFilter === 'all' && this.data.albumTypeFilter === 'all') {
      return;
    }
    this.setData({
      albumStatusFilter: 'all',
      albumTypeFilter: 'all',
    }, () => {
      this.applyWalkFilter();
    });
  },

  toggleAlbumFilter() {
    this.setData({ albumFilterExpanded: !this.data.albumFilterExpanded });
  },

  applyWalkFilter() {
    const allWalks = Array.isArray(this.data.allWalks) ? this.data.allWalks : [];
    const statusFilter = this.data.albumStatusFilter || 'all';
    const typeFilter = this.data.albumTypeFilter || 'all';
    const walks = allWalks.filter((item) => {
      const statusMatched = statusFilter === 'all' || item.albumStatusKey === statusFilter;
      const typeMatched = typeFilter === 'all' || normalizeAlbumRecordType(item) === typeFilter;
      return statusMatched && typeMatched;
    });
    const emptyState = buildAlbumEmptyState(statusFilter, typeFilter);
    const albumStatusCounts = buildAlbumStatusCounts(allWalks, typeFilter);
    const albumTypeCounts = buildAlbumTypeCounts(allWalks, statusFilter);
    this.setData({
      walks,
      albumStatusCounts,
      albumStatusChips: buildAlbumStatusChips(albumStatusCounts),
      albumTypeCounts,
      albumTypeChips: buildAlbumTypeChips(albumTypeCounts),
      albumEmptyTitle: emptyState.title,
      albumEmptySubtitle: emptyState.subtitle,
      albumFilterSummary: buildAlbumFilterSummary(statusFilter, typeFilter),
      albumResultCountLabel: buildAlbumResultCountLabel(walks.length),
    });
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

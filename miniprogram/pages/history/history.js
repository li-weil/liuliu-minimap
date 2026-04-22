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

function resolveAlbumSortTimestamp(item) {
  if (!item || typeof item !== 'object') {
    return 0;
  }
  const statusKey = item.albumStatusKey || normalizeAlbumStatus(item);
  if (statusKey === 'finished') {
    return Number(item.endedAt || item.updatedAt || item.createdAt || 0);
  }
  return Number(item.startedAt || item.createdAt || item.updatedAt || 0);
}

function resolveAlbumSortRank(item) {
  const statusKey = item && item.albumStatusKey ? item.albumStatusKey : normalizeAlbumStatus(item);
  if (statusKey === 'active') {
    return 0;
  }
  if (statusKey === 'pending') {
    return 1;
  }
  return 2;
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

const ALBUM_PAGE_SIZE = 10;
const ALBUM_FETCH_PAGE_SIZE = 50;

function normalizeAlbumStatus(item) {
  if (!item || typeof item !== 'object') {
    return 'pending';
  }

  const status = String(item.status || '').toLowerCase();
  if (status === 'finished' || item.endedAt) {
    return 'finished';
  }
  if (status === 'waiting' || status === 'pending') {
    return 'pending';
  }
  if (status === 'active') {
    return 'active';
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

function createDefaultAlbumStats() {
  const emptyStatusCounts = {
    all: 0,
    pending: 0,
    active: 0,
    finished: 0,
  };
  return {
    totalCount: 0,
    soloCount: 0,
    teamCount: 0,
    statusCounts: { ...emptyStatusCounts },
    typeStatusCounts: {
      solo: { ...emptyStatusCounts },
      team: { ...emptyStatusCounts },
    },
    updatedAt: 0,
  };
}

function normalizeAlbumStats(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const defaults = createDefaultAlbumStats();
  const statusCounts = value.statusCounts || {};
  const typeStatusCounts = value.typeStatusCounts || {};
  const albumStats = {
    totalCount: Number(value.totalCount || 0),
    soloCount: Number(value.soloCount || 0),
    teamCount: Number(value.teamCount || 0),
    statusCounts: {
      ...defaults.statusCounts,
      all: Number(statusCounts.all || value.totalCount || 0),
      pending: Number(statusCounts.pending || 0),
      active: Number(statusCounts.active || 0),
      finished: Number(statusCounts.finished || 0),
    },
    typeStatusCounts: {
      solo: {
        ...defaults.typeStatusCounts.solo,
        ...(typeStatusCounts.solo || {}),
        all: Number((typeStatusCounts.solo && typeStatusCounts.solo.all) || value.soloCount || 0),
      },
      team: {
        ...defaults.typeStatusCounts.team,
        ...(typeStatusCounts.team || {}),
        all: Number((typeStatusCounts.team && typeStatusCounts.team.all) || value.teamCount || 0),
      },
    },
    updatedAt: Number(value.updatedAt || 0),
  };
  return Number.isFinite(albumStats.totalCount) ? albumStats : null;
}

function getAlbumStatsCount(albumStats, statusKey = 'all', typeKey = 'all') {
  if (!albumStats) {
    return null;
  }
  const normalizedStatus = statusKey || 'all';
  const normalizedType = typeKey || 'all';
  if (normalizedType === 'all') {
    return Number((albumStats.statusCounts || {})[normalizedStatus] || 0);
  }
  const typeCounts = (albumStats.typeStatusCounts || {})[normalizedType] || {};
  return Number(typeCounts[normalizedStatus] || 0);
}

function buildAlbumStatusCountsFromStats(albumStats, typeFilter = 'all') {
  if (!albumStats) {
    return null;
  }
  const source = typeFilter === 'all'
    ? albumStats.statusCounts || {}
    : ((albumStats.typeStatusCounts || {})[typeFilter] || {});
  return {
    all: Number(source.all || 0),
    pending: Number(source.pending || 0),
    active: Number(source.active || 0),
    finished: Number(source.finished || 0),
  };
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

function buildAlbumTypeCountsFromStats(albumStats, statusFilter = 'all') {
  if (!albumStats) {
    return null;
  }
  const normalizedStatus = statusFilter || 'all';
  return {
    all: Number((albumStats.statusCounts || {})[normalizedStatus] || 0),
    solo: Number((((albumStats.typeStatusCounts || {}).solo || {})[normalizedStatus]) || 0),
    team: Number((((albumStats.typeStatusCounts || {}).team || {})[normalizedStatus]) || 0),
  };
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
  return `共 ${Number(count || 0)} 条记录`;
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

function normalizeHistoryWalk(item) {
  const albumStatusKey = normalizeAlbumStatus(item);
  const recordType = normalizeAlbumRecordType(item);
  const recordId = item && (item._id || item.id) ? (item._id || item.id) : '';
  return {
    ...item,
    recordType,
    albumRecordKey: `${recordType}:${recordId}`,
    createdAtLabel: formatDate(item.createdAt),
    albumStatusKey,
    albumStatusLabel: getAlbumStatusLabel(albumStatusKey),
  };
}

function getWalkIdentity(item) {
  if (!item) {
    return '';
  }
  return `${normalizeAlbumRecordType(item)}:${item._id || item.id || ''}`;
}

function mergeWalkPages(existingWalks = [], incomingWalks = []) {
  const result = [];
  const seen = new Set();
  [...existingWalks, ...incomingWalks].forEach((item) => {
    const key = getWalkIdentity(item);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(item);
  });
  return result.sort(compareHistoryWalks);
}

function compareHistoryWalks(left, right) {
  const leftRank = resolveAlbumSortRank(left);
  const rightRank = resolveAlbumSortRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  return resolveAlbumSortTimestamp(right) - resolveAlbumSortTimestamp(left);
}

function resolveListPage(result = {}, fallbackOffset = 0, fallbackLimit = ALBUM_FETCH_PAGE_SIZE) {
  const records = Array.isArray(result.records) ? result.records : [];
  const pagination = result.pagination || {};
  const nextOffset = pagination.nextOffset !== undefined
    ? Number(pagination.nextOffset || 0)
    : fallbackOffset + records.length;
  const hasMore = pagination.hasMore !== undefined
    ? !!pagination.hasMore
    : records.length >= fallbackLimit;
  return {
    records,
    nextOffset,
    hasMore,
  };
}

function buildAlbumPagerItems(currentPage, totalPages) {
  const total = Number(totalPages || 0);
  if (total <= 1) {
    return [];
  }
  const current = Math.min(Math.max(Number(currentPage || 1), 1), total);
  const pages = [];
  const addPage = (page) => {
    if (page < 1 || page > total || pages.includes(page)) {
      return;
    }
    pages.push(page);
  };

  if (total <= 9) {
    for (let page = 1; page <= total; page += 1) {
      addPage(page);
    }
  } else if (current <= 5) {
    for (let page = 1; page <= 7; page += 1) {
      addPage(page);
    }
    addPage(total);
  } else if (current >= total - 4) {
    addPage(1);
    for (let page = total - 6; page <= total; page += 1) {
      addPage(page);
    }
  } else {
    addPage(1);
    for (let page = current - 2; page <= current + 2; page += 1) {
      addPage(page);
    }
    addPage(total);
  }

  pages.sort((left, right) => left - right);
  const items = [];
  pages.forEach((page, index) => {
    const previous = pages[index - 1];
    if (previous && page - previous > 1) {
      items.push({
        key: `ellipsis-${previous}-${page}`,
        type: 'ellipsis',
        label: '...',
      });
    }
    items.push({
      key: `page-${page}`,
      type: 'page',
      label: String(page),
      page,
      active: page === current,
    });
  });
  return items;
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
    albumStats: createDefaultAlbumStats(),
    albumTotalCount: 0,
    albumCurrentPage: 1,
    albumTotalPages: 0,
    albumPagerItems: [],
    albumPagerSummary: '',
    albumJumpPageValue: '',
    albumPageTransitioning: false,
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

  onLoad() {
    this.setData({
      albumCurrentPage: 1,
      albumPagerItems: [],
      albumPagerSummary: '',
      albumJumpPageValue: '',
      albumPageTransitioning: false,
    });
  },

  onUnload() {
    this.clearAlbumPageTransitionTimers();
  },

  async onShow() {
    await app.ensureUserReady();
    const user = app.globalData.user || null;
    this.setData({
      user,
      albumStats: normalizeAlbumStats(user && user.albumStats) || createDefaultAlbumStats(),
      albumTotalCount: getAlbumStatsCount(normalizeAlbumStats(user && user.albumStats), 'all', 'all') || 0,
      loginState: user ? 'ready' : (isManualLogoutSuppressed() ? 'paused' : 'register'),
    });
    if (!user) {
      this.clearAlbumPageTransitionTimers();
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
        albumStats: createDefaultAlbumStats(),
        albumTotalCount: 0,
        albumCurrentPage: 1,
        albumTotalPages: 0,
        albumPagerItems: [],
        albumPagerSummary: '',
        albumJumpPageValue: '',
        albumPageTransitioning: false,
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
    this.clearAlbumPageTransitionTimers();
    this.setData({
      loading: true,
      albumCurrentPage: 1,
      albumPagerItems: [],
      albumPagerSummary: '',
      albumPageTransitioning: false,
    });
    try {
      const [soloResult, teamResult, achievementResult] = await Promise.all([
        this.loadAllAlbumRecords(listMyWalks),
        this.loadAllAlbumRecords(listMyTeamWalks),
        listMyAchievements(),
      ]);
      const albumStats = normalizeAlbumStats(soloResult.albumStats)
        || normalizeAlbumStats(teamResult.albumStats)
        || normalizeAlbumStats(this.data.user && this.data.user.albumStats)
        || null;
      const walks = mergeWalkPages([], [
        ...soloResult.records,
        ...teamResult.records,
      ].map(normalizeHistoryWalk));
      const albumStatusCounts = buildAlbumStatusCounts(walks, this.data.albumTypeFilter || 'all');
      const albumTypeCounts = buildAlbumTypeCounts(walks, this.data.albumStatusFilter || 'all');
      const nextData = {
        allWalks: walks,
        albumStats: albumStats || createDefaultAlbumStats(),
        albumTotalCount: walks.length,
        albumStatusCounts,
        albumStatusChips: buildAlbumStatusChips(albumStatusCounts),
        albumTypeCounts,
        albumTypeChips: buildAlbumTypeChips(albumTypeCounts),
      };

      const achievements = await hydrateAchievementAssets(achievementResult.achievements || []);
      const featuredAchievement = this.resolveFeaturedAchievement(achievements);
      const recentAchievements = buildRecentAchievements(achievements);
      const achievementSummary = achievementResult.summary || {
        unlockedCount: 0,
        totalCount: achievements.length,
        completionRate: 0,
      };
      app.globalData.achievementSnapshot = {
        achievements,
        recentAchievements,
        summary: achievementSummary,
        updatedAt: Date.now(),
      };
      Object.assign(nextData, {
        achievements,
        achievementSummary,
        featuredAchievement,
      });

      if (albumStats && this.data.user) {
        const nextUser = {
          ...this.data.user,
          albumStats,
        };
        nextData.user = nextUser;
        if (app.setCurrentUser) {
          app.setCurrentUser(nextUser);
        }
      }

      this.setData(nextData, () => {
        this.applyWalkFilter();
      });
      this.notifyNewAchievements(achievements);
    } catch (error) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadAllAlbumRecords(service) {
    const records = [];
    const seen = new Set();
    let albumStats = null;
    let offset = 0;
    let hasMore = true;
    let guard = 0;

    while (hasMore && guard < 200) {
      const result = await service({
        limit: ALBUM_FETCH_PAGE_SIZE,
        offset,
        sort: 'album',
      });
      const incoming = Array.isArray(result.records) ? result.records : [];
      const nextStats = normalizeAlbumStats(result && result.albumStats);
      if (nextStats) {
        albumStats = nextStats;
      }
      let newCount = 0;
      incoming.forEach((item) => {
        const id = item && (item._id || item.id);
        if (!id || seen.has(id)) {
          return;
        }
        seen.add(id);
        records.push(item);
        newCount += 1;
      });
      const page = resolveListPage(result, offset, ALBUM_FETCH_PAGE_SIZE);
      hasMore = !!page.hasMore && page.nextOffset > offset && incoming.length > 0 && newCount > 0;
      offset = page.nextOffset;
      guard += 1;
    }

    return {
      records,
      albumStats,
    };
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

  clearAlbumPageTransitionTimers() {
    if (this.albumPageTransitionTimer) {
      clearTimeout(this.albumPageTransitionTimer);
      this.albumPageTransitionTimer = null;
    }
    if (this.albumPageSettleTimer) {
      clearTimeout(this.albumPageSettleTimer);
      this.albumPageSettleTimer = null;
    }
    if (this.albumPageScrollTimer) {
      clearTimeout(this.albumPageScrollTimer);
      this.albumPageScrollTimer = null;
    }
  },

  switchAlbumStatus(event) {
    const nextFilter = event.currentTarget.dataset.status;
    if (!nextFilter || nextFilter === this.data.albumStatusFilter) {
      return;
    }
    this.clearAlbumPageTransitionTimers();
    this.setData({
      albumStatusFilter: nextFilter,
      albumCurrentPage: 1,
      albumJumpPageValue: '',
      albumPageTransitioning: false,
    }, () => {
      this.applyWalkFilter();
    });
  },

  switchAlbumType(event) {
    const nextFilter = event.currentTarget.dataset.type;
    if (!nextFilter || nextFilter === this.data.albumTypeFilter) {
      return;
    }
    this.clearAlbumPageTransitionTimers();
    this.setData({
      albumTypeFilter: nextFilter,
      albumCurrentPage: 1,
      albumJumpPageValue: '',
      albumPageTransitioning: false,
    }, () => {
      this.applyWalkFilter();
    });
  },

  resetAlbumFilters() {
    if (this.data.albumStatusFilter === 'all' && this.data.albumTypeFilter === 'all') {
      return;
    }
    this.clearAlbumPageTransitionTimers();
    this.setData({
      albumStatusFilter: 'all',
      albumTypeFilter: 'all',
      albumCurrentPage: 1,
      albumJumpPageValue: '',
      albumPageTransitioning: false,
    }, () => {
      this.applyWalkFilter();
    });
  },

  toggleAlbumFilter() {
    this.setData({ albumFilterExpanded: !this.data.albumFilterExpanded });
  },

  switchAlbumPage(event) {
    const page = Number(event.currentTarget.dataset.page || 1);
    this.changeAlbumPage(page);
  },

  handleAlbumJumpInput(event) {
    this.setData({
      albumJumpPageValue: String(event.detail.value || '').replace(/[^\d]/g, '').slice(0, 4),
    });
  },

  submitAlbumJump() {
    const totalPages = Number(this.data.albumTotalPages || 0);
    const page = Number(this.data.albumJumpPageValue || 0);
    if (!totalPages) {
      return;
    }
    if (!page || page < 1 || page > totalPages) {
      wx.showToast({
        title: `请输入 1-${totalPages} 页`,
        icon: 'none',
      });
      return;
    }
    this.changeAlbumPage(page);
  },

  changeAlbumPage(page) {
    const totalPages = Number(this.data.albumTotalPages || 0);
    const nextPage = Math.min(Math.max(Number(page || 1), 1), totalPages || 1);
    if (!totalPages) {
      return;
    }
    if (nextPage === this.data.albumCurrentPage) {
      if (this.data.albumJumpPageValue) {
        this.setData({ albumJumpPageValue: '' });
      }
      return;
    }

    this.clearAlbumPageTransitionTimers();
    this.setData({ albumPageTransitioning: true });
    this.albumPageTransitionTimer = setTimeout(() => {
      this.albumPageTransitionTimer = null;
      this.setData({
        albumCurrentPage: nextPage,
        albumJumpPageValue: '',
      }, () => {
        this.applyWalkFilter();
        this.scrollAlbumPageToBottom();
        this.albumPageSettleTimer = setTimeout(() => {
          this.albumPageSettleTimer = null;
          this.setData({ albumPageTransitioning: false });
        }, 240);
      });
    }, 80);
  },

  scrollAlbumPageToBottom() {
    if (!wx.pageScrollTo) {
      return;
    }
    const scrollToBottom = () => {
      wx.pageScrollTo({
        scrollTop: 999999,
        duration: 260,
      });
    };
    if (wx.nextTick) {
      wx.nextTick(scrollToBottom);
      return;
    }
    this.albumPageScrollTimer = setTimeout(() => {
      this.albumPageScrollTimer = null;
      scrollToBottom();
    }, 30);
  },

  applyWalkFilter() {
    const allWalks = Array.isArray(this.data.allWalks) ? this.data.allWalks : [];
    const statusFilter = this.data.albumStatusFilter || 'all';
    const typeFilter = this.data.albumTypeFilter || 'all';
    const filteredWalks = allWalks.filter((item) => {
      const statusMatched = statusFilter === 'all' || item.albumStatusKey === statusFilter;
      const typeMatched = typeFilter === 'all' || normalizeAlbumRecordType(item) === typeFilter;
      return statusMatched && typeMatched;
    });
    const emptyState = buildAlbumEmptyState(statusFilter, typeFilter);
    const albumStatusCounts = buildAlbumStatusCounts(allWalks, typeFilter);
    const albumTypeCounts = buildAlbumTypeCounts(allWalks, statusFilter);
    const resultCount = filteredWalks.length;
    const totalPages = resultCount > 0 ? Math.ceil(resultCount / ALBUM_PAGE_SIZE) : 0;
    const currentPage = totalPages
      ? Math.min(Math.max(Number(this.data.albumCurrentPage || 1), 1), totalPages)
      : 1;
    const pageStart = (currentPage - 1) * ALBUM_PAGE_SIZE;
    const walks = filteredWalks.slice(pageStart, pageStart + ALBUM_PAGE_SIZE);
    this.setData({
      walks,
      albumCurrentPage: currentPage,
      albumTotalPages: totalPages,
      albumPagerItems: buildAlbumPagerItems(currentPage, totalPages),
      albumPagerSummary: totalPages ? `第 ${currentPage} / ${totalPages} 页` : '',
      albumStatusCounts,
      albumStatusChips: buildAlbumStatusChips(albumStatusCounts),
      albumTypeCounts,
      albumTypeChips: buildAlbumTypeChips(albumTypeCounts),
      albumEmptyTitle: emptyState.title,
      albumEmptySubtitle: emptyState.subtitle,
      albumFilterSummary: buildAlbumFilterSummary(statusFilter, typeFilter),
      albumResultCountLabel: buildAlbumResultCountLabel(resultCount),
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

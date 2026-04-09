const app = getApp();
const {
  COMBINE_THEME_OPTIONS,
  PRESET_THEMES,
  RANDOM_THEME_CATEGORIES,
  MOODS,
  WEATHERS,
  SEASONS,
  PREFERENCES,
} = require('../../utils/constants');
const { explainLocationError, getCurrentLocation } = require('../../utils/location');
const { getRegeo, normalizeAmapLocation } = require('../../utils/amap');
const { fetchNearbyPois, searchLocations } = require('../../services/map');
const { createTeamRoom } = require('../../services/team');
const { generateCombinedTheme, generateRandomTheme, generateTheme } = require('../../services/theme');
const { createWalk } = require('../../services/walk');
const { getBackendProvider } = require('../../services/api');
const { isManualLogoutSuppressed } = require('../../services/user');
const {
  createDefaultPrivacyPopup,
  ensurePrivacyAuthorization,
  openPrivacyContract,
  rejectPrivacyAuthorization,
  resolvePrivacyAuthorization,
} = require('../../utils/privacy');

function normalizeMissionText(mission) {
  if (typeof mission === 'string') {
    const trimmed = mission.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return normalizeMissionText(JSON.parse(trimmed));
      } catch (error) {
        return trimmed;
      }
    }
    return trimmed;
  }
  if (mission && typeof mission === 'object') {
    if (typeof mission.name === 'string' && typeof mission.description === 'string') {
      return `${mission.name}：${mission.description}`;
    }
    const preferred =
      mission.task ||
      mission.text ||
      mission.title ||
      mission.label ||
      mission.mission ||
      mission.name ||
      mission.description;
    if (preferred) {
      return String(preferred).trim();
    }
    const firstStringValue = Object.keys(mission)
      .map((key) => mission[key])
      .find((value) => typeof value === 'string' && value.trim());
    if (firstStringValue) {
      return firstStringValue.trim();
    }
    return JSON.stringify(mission);
  }
  return String(mission);
}

function pickDisplayGlyph(theme) {
  const source = (theme && (theme.glyph || theme.displayGlyph || theme.category || theme.title)) || '遛';
  const matched = String(source).replace(/漫步|主题|：.*/g, '').trim();
  return matched ? matched.slice(0, 1) : '遛';
}

function trimTheme(theme, walkMode) {
  const missionCount = walkMode === 'advanced' ? 3 : 1;
  const rawMissions = theme.allMissions || theme.missions || [];
  const allMissions = rawMissions.map(normalizeMissionText);
  return {
    ...theme,
    displayGlyph: pickDisplayGlyph(theme),
    allMissions,
    missions: allMissions.slice(0, missionCount),
  };
}

function buildCombineOptionViews(selected) {
  const set = new Set(selected || []);
  return COMBINE_THEME_OPTIONS.map((item) => ({
    label: item,
    active: set.has(item),
  }));
}

function buildSelectedThemeCategories(selected) {
  return (selected || []).map((item) => (String(item).includes('漫步') ? String(item) : `${item}漫步`));
}

function pickRandomThemeCategory(categoryPool) {
  const categories = Array.isArray(categoryPool) ? categoryPool.filter(Boolean) : [];
  if (!categories.length) {
    return '形状';
  }
  return String(categories[Math.floor(Math.random() * categories.length)]).replace(/漫步/g, '').trim() || '形状';
}

function buildGenerationContext(pageData) {
  if (!pageData || pageData.walkMode !== 'advanced') {
    return {};
  }

  return {
    weather: pageData.weather || '',
    season: pageData.season || '',
    mood: pageData.mood || '',
    preference: pageData.preference || '',
  };
}

function buildSearchResultViews(results) {
  function pickTypeLabels(type) {
    return String(type || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 2);
  }

  return (results || []).slice(0, 20).map((item, index) => ({
    id: item.id || item.location || `${item.name || item.address || 'result'}-${index}`,
    name: item.name || item.address || item.district || '推荐地点',
    address: item.address || item.district || '',
    district: item.district || item.city || '',
    type: item.type ? String(item.type).split(';')[0] : '',
    typeLabels: pickTypeLabels(item.type),
    latitude:
      item.latitude !== undefined && item.latitude !== null
        ? Number(item.latitude)
        : item.lat !== undefined && item.lat !== null
          ? Number(item.lat)
          : item.location
            ? Number(String(item.location).split(',')[1])
            : null,
    longitude:
      item.longitude !== undefined && item.longitude !== null
        ? Number(item.longitude)
        : item.lng !== undefined && item.lng !== null
          ? Number(item.lng)
          : item.location
            ? Number(String(item.location).split(',')[0])
            : null,
  }));
}

function looksLikeStreetAddress(value) {
  if (!value) {
    return false;
  }
  const text = String(value).trim();
  return /路|街|巷|道|号|弄|村|大道/.test(text) && /\d/.test(text);
}

function pickBestLocationName({ location, amapSummary, contextResponse }) {
  const candidates = [
    amapSummary && amapSummary.pois && amapSummary.pois[0] && amapSummary.pois[0].name,
    location && location.placeName,
    location && location.name,
    amapSummary && amapSummary.placeName,
    contextResponse && contextResponse.placeName,
    location && location.address,
  ]
    .map((item) => (item ? String(item).trim() : ''))
    .filter(Boolean);

  const nonAddressLike = candidates.find((item) => !looksLikeStreetAddress(item) && item !== '地图选点');
  return nonAddressLike || candidates[0] || '当前位置';
}

function buildNearbyPlaceViews(results) {
  return (results || []).slice(0, 12).map((item, index) => ({
    id: item.id || item.link || `${item.title || 'poi'}-${index}`,
    name: item.title || item.name || '附近地点',
    address: item.address || item.district || '',
    district: item.district || item.city || '',
    type: item.type ? String(item.type).split(';')[0] : '',
    latitude:
      item.latitude !== undefined && item.latitude !== null
        ? Number(item.latitude)
        : item.lat !== undefined && item.lat !== null
          ? Number(item.lat)
          : null,
    longitude:
      item.longitude !== undefined && item.longitude !== null
        ? Number(item.longitude)
        : item.lng !== undefined && item.lng !== null
          ? Number(item.lng)
          : null,
  })).filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
}

function extractErrorMessage(error, fallback) {
  return String((error && error.errMsg) || (error && error.message) || fallback || '操作失败');
}

function buildHomeShareTitle(data = {}) {
  const locationName = data.locationName || '这座城市';
  const currentTheme = data.currentTheme || null;
  const themeTitle = currentTheme && currentTheme.title ? currentTheme.title : '城市漫步主题';

  if (data.journeyMode === 'team') {
    return `一起去 ${locationName} 遛遛`;
  }

  return `我在 ${locationName} 遛遛`;
}

function buildBrandedHomeShareTitle(data = {}) {
  const user = app.globalData.user || null;
  if (user && user.nickName) {
    return `遛遛 | ${user.nickName} 邀你一起 citywalk`;
  }

  return '遛遛 | 邀你一起 citywalk';
}

function explainNearbyPoiError(error) {
  const message = extractErrorMessage(error, '周边地点加载失败');

  if (/function not found|找不到该函数|not found/i.test(message)) {
    return {
      title: '周边地点功能未部署',
      content: '云函数 fetchNearbyPois 还没有部署到当前云环境，请先上传并部署该云函数后再试。',
    };
  }

  if (/missing_amap_web_key/i.test(message)) {
    return {
      title: '缺少高德服务 Key',
      content: '云函数 fetchNearbyPois 没有配置可用的高德 Web 服务 Key。请在云函数环境变量里设置 AMAP_WEB_KEY 后，再重新部署并重试。',
    };
  }

  if (/INVALID_USER_KEY|USERKEY_PLAT_NOMATCH|SERVICE_NOT_AVAILABLE|DAILY_QUERY_OVER_LIMIT|ACCESS_TOO_FREQUENT|INVALID_IP/i.test(message)) {
    return {
      title: '高德 Key 权限异常',
      content: `高德周边 POI 请求失败：${message}。请检查当前 Key 是否开通 Web 服务能力、配额是否超限、平台权限是否匹配。`,
    };
  }

  if (/timeout|超时/i.test(message)) {
    return {
      title: '周边地点请求超时',
      content: `请求高德周边 POI 超时：${message}。请检查网络状态后重试。`,
    };
  }

  if (/invalid_location/i.test(message)) {
    return {
      title: '探索点坐标无效',
      content: '当前探索点没有拿到有效经纬度，请重新定位或重新设定探索点后再试。',
    };
  }

  return {
    title: '周边地点加载失败',
    content: message,
  };
}

Page({
  data: {
    combineOptionViews: buildCombineOptionViews([]),
    combineSelections: [],
    currentTheme: null,
    currentThemeSource: 'preset',
    displaySummary: '根据你的位置与模式生成今天的 citywalk 任务。',
    displayTag: '展示栏',
    isCombining: false,
    moodOptions: MOODS,
    weatherOptions: WEATHERS,
    seasonOptions: SEASONS,
    preferenceOptions: PREFERENCES,
    randomCategories: RANDOM_THEME_CATEGORIES,
    mood: MOODS[4],
    weather: WEATHERS[0],
    season: SEASONS[0],
    preference: PREFERENCES[2],
    locationName: '当前位置',
    locationAddress: '',
    latitude: null,
    longitude: null,
    mapCenterLatitude: null,
    mapCenterLongitude: null,
    mapScale: 14,
    mapMarkers: [],
    mapCircles: [],
    isMapDragging: false,
    hasConfirmedExplorePoint: false,
    walkMode: 'pure',
    journeyMode: 'solo',
    isGenerating: false,
    searchKeyword: '',
    searchResults: [],
    searchResultCount: 0,
    loadingSearch: false,
    nearbyPlaces: [],
    nearbyExpanded: false,
    loadingNearbyPlaces: false,
    supportsNearbyPois: false,
    privacyPopup: createDefaultPrivacyPopup(),
  },

  onLoad() {
    this.locationResolveToken = 0;
    const randomTheme = PRESET_THEMES[Math.floor(Math.random() * PRESET_THEMES.length)];
    const currentTheme = trimTheme({ ...randomTheme, locationName: '当前位置', allMissions: randomTheme.missions }, 'pure');
    this.setData({
      currentTheme,
      latitude: 39.908823,
      longitude: 116.39747,
      mapCenterLatitude: 39.908823,
      mapCenterLongitude: 116.39747,
      mapMarkers: [{
        id: 0,
        latitude: 39.908823,
        longitude: 116.39747,
        width: 28,
        height: 28,
        callout: {
          content: '等待选点',
          display: 'BYCLICK',
          padding: 8,
          borderRadius: 10,
          bgColor: '#ffffff',
          color: '#2f2b24',
          fontSize: 12,
        },
      }],
      supportsNearbyPois: true,
    });
    app.globalData.currentTheme = currentTheme;
    this.syncDisplayMeta(currentTheme, 'preset', 'pure');
  },

  onReady() {
    this.mapCtx = wx.createMapContext('explore-map', this);
    this.locationResolveToken = 0;
  },

  onShareAppMessage() {
    return {
      title: buildBrandedHomeShareTitle(this.data),
      path: '/pages/index/index',
    };
  },

  onShareTimeline() {
    return {
      title: buildBrandedHomeShareTitle(this.data),
      query: '',
    };
  },

  buildMapState({ latitude, longitude, placeName }) {
    return {
      latitude,
      longitude,
      mapCenterLatitude: latitude,
      mapCenterLongitude: longitude,
      mapMarkers: [{
        id: 0,
        latitude,
        longitude,
        width: 30,
        height: 30,
        anchor: { x: 0.5, y: 1 },
        callout: {
          content: placeName || '已选地点',
          display: 'BYCLICK',
          padding: 8,
          borderRadius: 10,
          bgColor: '#ffffff',
          color: '#2f2b24',
          fontSize: 12,
        },
      }],
      mapCircles: [{
        latitude,
        longitude,
        radius: 3000,
        color: '#5a5a40',
        fillColor: '#5a5a4022',
        strokeWidth: 2,
      }],
    };
  },

  syncDisplayMeta(theme, source, walkMode = this.data.walkMode) {
    const modeLabel = walkMode === 'advanced' ? '进阶模式' : '纯粹模式';
    const sourceLabelMap = {
      preset: '预设展示',
      'rag+ai': 'AI 生成',
      'rag-fallback': 'RAG 兜底',
      'random+ai': '随机 AI',
      'random-fallback': '随机兜底',
      'combined+ai': '组合 AI',
      'combined-fallback': '组合兜底',
    };
    const sourceLabel = sourceLabelMap[source] || '主题结果';
    this.setData({
      currentThemeSource: source,
      displayTag: sourceLabel,
      displaySummary: `${modeLabel} · ${theme.category || '探索'} · ${theme.missions ? theme.missions.length : 0} 个任务`,
    });
  },

  applyLocationBaseState(location, fallback = {}) {
    const latitude = Number(location && location.latitude);
    const longitude = Number(location && location.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return false;
    }

    const placeName = fallback.placeName || location.placeName || location.name || this.data.locationName || '已选地点';
    const locationAddress = fallback.locationAddress !== undefined
      ? fallback.locationAddress
      : (location.address || this.data.locationAddress || '');

    this.setData({
      latitude,
      longitude,
      locationName: placeName,
      locationAddress,
      searchResults: [],
      searchResultCount: 0,
      ...this.buildMapState({
        latitude,
        longitude,
        placeName,
      }),
      nearbyPlaces: [],
      nearbyExpanded: false,
    });
    return true;
  },

  markExplorePointConfirmed() {
    if (!this.data.hasConfirmedExplorePoint) {
      this.setData({ hasConfirmedExplorePoint: true });
    }
  },

  setOption(event) {
    const { field, value } = event.currentTarget.dataset;
    this.setData({ [field]: value });
    if (field === 'walkMode' && this.data.currentTheme) {
      const nextTheme = trimTheme(this.data.currentTheme, value);
      this.setData({ currentTheme: nextTheme });
      app.globalData.currentTheme = nextTheme;
      this.syncDisplayMeta(nextTheme, this.data.currentThemeSource, value);
    }
  },

  toggleCombineSelection(event) {
    const value = event.currentTarget.dataset.value;
    const current = new Set(this.data.combineSelections);
    if (current.has(value)) {
      current.delete(value);
    } else if (current.size < 2 || !current.has(value)) {
      current.add(value);
    }
    const combineSelections = Array.from(current).slice(0, 2);
    this.setData({ combineSelections, combineOptionViews: buildCombineOptionViews(combineSelections) });
  },

  async enrichLocation(location) {
    const token = ++this.locationResolveToken;
    const regeo = await getRegeo(location).catch(() => null);
    const amapSummary = normalizeAmapLocation(regeo, location.placeName || location.name || location.address);
    const displayLocationName = pickBestLocationName({
      location,
      amapSummary,
      contextResponse: null,
    });
    if (token !== this.locationResolveToken) {
      return;
    }
    this.setData({
      latitude: location.latitude,
      longitude: location.longitude,
      locationName: displayLocationName,
      locationAddress: amapSummary.address || location.address || '',
      searchResults: [],
      searchResultCount: 0,
      ...this.buildMapState({
        latitude: location.latitude,
        longitude: location.longitude,
        placeName: displayLocationName || location.name || '已选地点',
      }),
      nearbyPlaces: [],
      nearbyExpanded: false,
    });
    this.loadNearbyPlaces(location.latitude, location.longitude).then(() => {
      if (token !== this.locationResolveToken) {
        return;
      }
      if (this.data.nearbyPlaces.length) {
        this.setData({ nearbyExpanded: true });
      }
    });
  },

  async loadNearbyPlaces(latitude, longitude) {
    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
      this.setData({ nearbyPlaces: [], nearbyExpanded: false, loadingNearbyPlaces: false });
      return;
    }

    this.setData({ loadingNearbyPlaces: true });
    try {
      const nearbyPlaces = buildNearbyPlaceViews(await fetchNearbyPois(Number(latitude), Number(longitude)));
      this.setData({
        nearbyPlaces,
        nearbyExpanded: nearbyPlaces.length ? this.data.nearbyExpanded : false,
      });
    } catch (error) {
      this.setData({ nearbyPlaces: [], nearbyExpanded: false });
      const detail = explainNearbyPoiError(error);
      wx.showModal({
        title: detail.title,
        content: detail.content,
        showCancel: false,
        confirmText: '知道了',
      });
    } finally {
      this.setData({ loadingNearbyPlaces: false });
    }
  },

  toggleNearbyPanel() {
    if (this.data.nearbyExpanded) {
      this.setData({ nearbyExpanded: false });
      return;
    }

    const latitude = Number(this.data.latitude);
    const longitude = Number(this.data.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    if (this.data.nearbyPlaces.length) {
      this.setData({ nearbyExpanded: true });
      return;
    }

    this.loadNearbyPlaces(latitude, longitude).then(() => {
      if (this.data.nearbyPlaces.length) {
        this.setData({ nearbyExpanded: true });
      }
    });
  },

  async useCurrentLocation() {
    try {
      await ensurePrivacyAuthorization(this, {
        title: '开启定位前说明',
        content: '定位将用于获取当前位置、设定探索点，并为这次漫步生成更贴近当前位置的主题内容。',
      });
      wx.showLoading({ title: '定位中' });
      const result = await getCurrentLocation();
      const applied = this.applyLocationBaseState(result, {
        placeName: '定位成功',
        locationAddress: '',
      });
      wx.hideLoading();
      if (!applied) {
        throw new Error('invalid_location');
      }
      this.markExplorePointConfirmed();
      wx.showToast({ title: '已定位，正在补充地点推荐', icon: 'none', duration: 1800 });
      this.enrichLocation(result).catch(() => {});
    } catch (error) {
      if (error && error.message === 'privacy_authorization_denied') {
        wx.showToast({ title: '未同意隐私说明，暂时无法定位', icon: 'none' });
        return;
      }
      wx.showToast({ title: explainLocationError(error, '定位'), icon: 'none', duration: 2500 });
    } finally {
      wx.hideLoading();
    }
  },

  async handleChooseLocation() {
    wx.showToast({ title: '拖动下方地图后，点“设为探索点”', icon: 'none', duration: 2200 });
  },

  handleMapRegionChange(event) {
    const { type } = event;
    if (type === 'begin') {
      this.setData({ isMapDragging: true });
      return;
    }

    if (type !== 'end' || !this.mapCtx || !this.mapCtx.getCenterLocation) {
      return;
    }

    this.mapCtx.getCenterLocation({
      success: (res) => {
        this.setData({
          mapCenterLatitude: res.latitude,
          mapCenterLongitude: res.longitude,
          isMapDragging: false,
        });
      },
      fail: () => {
        this.setData({ isMapDragging: false });
      },
    });
  },

  async confirmMapCenterLocation() {
    wx.showLoading({ title: '读取位置' });
    try {
      const center = await new Promise((resolve, reject) => {
        if (!this.mapCtx || !this.mapCtx.getCenterLocation) {
          reject(new Error('map_center_unavailable'));
          return;
        }
        this.mapCtx.getCenterLocation({
          success: resolve,
          fail: reject,
        });
      });
      const latitude = Number(center.latitude);
      const longitude = Number(center.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('map_center_invalid');
      }
      this.setData({
        mapCenterLatitude: latitude,
        mapCenterLongitude: longitude,
      });
      const nextLocation = {
        latitude,
        longitude,
        name: '地图选点',
        address: '',
      };
      const applied = this.applyLocationBaseState(nextLocation, {
        placeName: '已设为探索点',
        locationAddress: '',
      });
      wx.hideLoading();
      if (!applied) {
        throw new Error('map_center_invalid');
      }
      this.markExplorePointConfirmed();
      wx.showToast({ title: '已设为探索点，正在补充地点推荐', icon: 'none', duration: 1800 });
      this.enrichLocation(nextLocation).catch(() => {});
    } catch (error) {
      wx.showToast({ title: explainLocationError(error, '选点'), icon: 'none', duration: 2500 });
    } finally {
      wx.hideLoading();
    }
  },

  handleSearchInput(event) {
    this.setData({ searchKeyword: event.detail.value });
  },

  async searchLocation() {
    const keyword = (this.data.searchKeyword || '').trim();
    if (!keyword) {
      wx.showToast({ title: '输入地点关键词', icon: 'none' });
      return;
    }

    this.setData({ loadingSearch: true });
    try {
      const searchResults = buildSearchResultViews(
        await searchLocations(
          keyword,
          this.data.latitude && this.data.longitude ? { latitude: this.data.latitude, longitude: this.data.longitude } : null,
        )
      );
      this.setData({ searchResults, searchResultCount: Array.isArray(searchResults) ? searchResults.length : 0 });

      if (!searchResults.length) {
        wx.showToast({ title: '暂无搜索建议，可直接手动选点', icon: 'none' });
      }
    } catch (error) {
      const message = String((error && error.errMsg) || (error && error.message) || '搜索失败');
      wx.showModal({
        title: '地点搜索失败',
        content: message,
        showCancel: false,
        confirmText: '知道了',
      });
    } finally {
      this.setData({ loadingSearch: false });
    }
  },

  async chooseSearchResult(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.searchResults[index];
    if (!item || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) {
      wx.showToast({ title: '该地点需要手动选点确认', icon: 'none' });
      return;
    }
    try {
      const applied = this.applyLocationBaseState(item, {
        placeName: item.name || '已选地点',
        locationAddress: item.address || '',
      });
      if (!applied) {
        wx.showToast({ title: '该地点需要手动选点确认', icon: 'none' });
        return;
      }
      this.markExplorePointConfirmed();
      this.setData({
        searchKeyword: item.name || '',
        searchResults: [],
        searchResultCount: 0,
      });
      wx.showToast({ title: '已选地点，正在补充地点推荐', icon: 'none', duration: 1800 });
      this.enrichLocation(item).catch(() => {});
    } catch (error) {
      wx.showToast({ title: '地点切换失败', icon: 'none' });
    }
  },

  async chooseNearbyPlace(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.nearbyPlaces[index];
    if (!item) {
      return;
    }
    wx.showLoading({ title: '切换地点' });
    try {
      this.markExplorePointConfirmed();
      await this.enrichLocation({
        latitude: item.latitude,
        longitude: item.longitude,
        name: item.name,
        address: item.address || '',
      });
      this.setData({ searchKeyword: item.name });
    } catch (error) {
      wx.showToast({ title: '地点切换失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  async handleGenerateTheme() {
    this.setData({ isGenerating: true });
    try {
      const selectedThemes = buildSelectedThemeCategories(this.data.combineSelections);
      const effectiveThemes = selectedThemes.length
        ? selectedThemes
        : buildSelectedThemeCategories([pickRandomThemeCategory(this.data.randomCategories)]);
      const result = await generateTheme({
        mood: this.data.mood,
        weather: this.data.weather,
        season: this.data.season,
        preference: this.data.preference,
        locationName: this.data.locationName,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        walkMode: this.data.walkMode,
        selectedThemes: effectiveThemes,
      });
      const currentTheme = trimTheme({ ...result.theme, allMissions: result.theme.missions, locationName: this.data.locationName }, this.data.walkMode);
      this.setData({ currentTheme });
      app.globalData.currentTheme = currentTheme;
      this.syncDisplayMeta(currentTheme, result.source || 'rag-fallback');
    } catch (error) {
      wx.showModal({
        title: '主题生成失败',
        content: extractErrorMessage(error, '主题生成失败'),
        showCancel: false,
        confirmText: '知道了',
      });
    } finally {
      this.setData({ isGenerating: false });
    }
  },

  async handleRandomTheme() {
    this.setData({ isGenerating: true });
    try {
      const categoryPool = this.data.randomCategories;
      const category = categoryPool[Math.floor(Math.random() * categoryPool.length)];
      const result = await generateRandomTheme({
        category,
        locationName: this.data.locationName,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        walkMode: this.data.walkMode,
        selectedThemes: [],
      });
      const currentTheme = trimTheme({ ...result.theme, allMissions: result.theme.missions, locationName: this.data.locationName }, this.data.walkMode);
      this.setData({ currentTheme });
      app.globalData.currentTheme = currentTheme;
      this.syncDisplayMeta(currentTheme, result.source || 'random-fallback');
    } catch (error) {
      wx.showModal({
        title: '随机生成失败',
        content: extractErrorMessage(error, '随机生成失败'),
        showCancel: false,
        confirmText: '知道了',
      });
    } finally {
      this.setData({ isGenerating: false });
    }
  },

  async handleSelectedThemeGenerate() {
    this.setData({ isCombining: true });
    try {
      const selections = this.data.combineSelections.length
        ? this.data.combineSelections
        : [pickRandomThemeCategory(this.data.randomCategories)];
      const result = selections.length === 1
        ? await generateTheme({
          mood: this.data.mood,
          weather: this.data.weather,
          season: this.data.season,
          preference: this.data.preference,
          locationName: this.data.locationName,
          latitude: this.data.latitude,
          longitude: this.data.longitude,
          walkMode: this.data.walkMode,
          selectedThemes: buildSelectedThemeCategories(selections),
        })
        : await generateCombinedTheme({
          categories: selections,
          locationName: this.data.locationName,
          latitude: this.data.latitude,
          longitude: this.data.longitude,
          walkMode: this.data.walkMode,
        });
      const currentTheme = trimTheme({ ...result.theme, allMissions: result.theme.missions, locationName: this.data.locationName }, this.data.walkMode);
      this.setData({ currentTheme });
      app.globalData.currentTheme = currentTheme;
      this.syncDisplayMeta(
        currentTheme,
        result.source || (selections.length === 1 ? 'rag-fallback' : 'combined-fallback')
      );
    } catch (error) {
      wx.showModal({
        title: '选择生成失败',
        content: extractErrorMessage(error, '选择生成失败'),
        showCancel: false,
        confirmText: '知道了',
      });
    } finally {
      this.setData({ isCombining: false });
    }
  },

  async handleStartWalk() {
    if (!this.data.currentTheme) {
      return;
    }

    if (!this.data.hasConfirmedExplorePoint) {
      wx.showToast({ title: '请先定位、搜索或设为探索点', icon: 'none', duration: 2500 });
      return;
    }

    if (this.data.journeyMode === 'team') {
      this.handleCreateTeamRoom();
      return;
    }

    await app.ensureUserReady();
    if (!app.globalData.user) {
      const pausedLogin = isManualLogoutSuppressed();
      wx.showModal({
        title: pausedLogin ? '先恢复登录' : '先完善资料',
        content: pausedLogin
          ? '你刚刚主动退出过账号，去个人页点一次登录后，就能开始并记录这次漫步。'
          : '开始漫步前，需要先在个人页设置一次头像和昵称。',
        confirmText: pausedLogin ? '去恢复' : '去设置',
        success: (res) => {
          if (res.confirm) {
            app.setPendingNavigation({
              url: '/pages/index/index',
              mode: 'switchTab',
            });
            wx.switchTab({ url: '/pages/profile/profile' });
          }
        },
      });
      return;
    }

    wx.showLoading({ title: '创建记录' });
    try {
      app.globalData.currentTheme = this.data.currentTheme;
      const generationContext = buildGenerationContext(this.data);
      const startedAt = Date.now();
      const result = await createWalk({
        themeSnapshot: this.data.currentTheme,
        themeTitle: this.data.currentTheme.title,
        locationName: this.data.locationName,
        locationAddress: this.data.locationAddress,
        routePoints: [],
        missionsCompleted: [],
        missionReviews: {},
        photoList: [],
        videoList: [],
        audioList: [],
        missionAssetMap: {},
        noteText: '',
        isPublic: false,
        walkMode: this.data.walkMode,
        generationSource: this.data.currentThemeSource,
        season: generationContext.season || '',
        generationContext,
        startedAt,
        trackStartedAt: null,
        trackStoppedAt: null,
        routeStats: {
          durationMs: 0,
          pointCount: 0,
          distanceMeters: 0,
        },
        sticker: null,
        status: 'active',
      });
      const walkId = result && result.id ? result.id : (result && result.walk && (result.walk.id || result.walk._id)) || '';
      if (!walkId) {
        throw new Error('missing_walk_id');
      }
      const draft = {
        walkId,
        status: 'active',
        completedMissions: [],
        missionAssetMap: {},
        missionReviews: {},
        startedAt,
        endedAt: null,
        trackStartedAt: null,
        trackStoppedAt: null,
        locationName: this.data.locationName,
        locationAddress: this.data.locationAddress,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        selectedMission: this.data.currentTheme.missions[0] || '',
        noteText: '',
        photoList: [],
        videoList: [],
        audioList: [],
        routePoints: [],
        routeStats: {
          durationMs: 0,
          pointCount: 0,
          distanceMeters: 0,
        },
        sticker: null,
        walkMode: this.data.walkMode,
        generationSource: this.data.currentThemeSource,
        season: generationContext.season || '',
        generationContext,
        isPublic: false,
      };
      app.setWalkDraft(draft, walkId);
      wx.navigateTo({ url: `/pages/record/record?id=${encodeURIComponent(walkId)}` });
    } catch (error) {
      wx.showModal({
        title: '创建记录失败',
        content: extractErrorMessage(error, '开始漫步失败'),
        showCancel: false,
        confirmText: '知道了',
      });
    } finally {
      wx.hideLoading();
    }
  },

  async handleCreateTeamRoom() {
    if (!this.data.currentTheme) {
      wx.showToast({ title: '先生成一个主题', icon: 'none' });
      return;
    }

    await app.ensureUserReady();
    if (!app.globalData.user) {
      const pausedLogin = isManualLogoutSuppressed();
      wx.showModal({
        title: pausedLogin ? '先恢复登录' : '先完善资料',
        content: pausedLogin
          ? '你刚刚主动退出过账号，去个人页点一次登录后，就能发起同行漫步。'
          : '发起同行漫步前，需要先在个人页设置一次头像和昵称。',
        confirmText: pausedLogin ? '去恢复' : '去设置',
        success: (res) => {
          if (res.confirm) {
            app.setPendingNavigation({
              url: '/pages/index/index',
              mode: 'switchTab',
            });
            wx.switchTab({ url: '/pages/profile/profile' });
          }
        },
      });
      return;
    }

    wx.showLoading({ title: '创建房间' });
    try {
      const generationContext = buildGenerationContext(this.data);
      const result = await createTeamRoom({
        themeSnapshot: this.data.currentTheme,
        themeTitle: this.data.currentTheme.title,
        locationName: this.data.locationName,
        locationAddress: this.data.locationAddress,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        walkMode: this.data.walkMode,
        season: generationContext.season || '',
        generationContext,
      });
      const roomId = result && result.roomId ? result.roomId : (result && result.room && result.room.id ? result.room.id : '');
      if (!roomId) {
        throw new Error('missing_room_id');
      }
      wx.navigateTo({ url: `/pages/team-room/team-room?roomId=${encodeURIComponent(roomId)}` });
    } catch (error) {
      wx.showModal({
        title: '创建房间失败',
        content: extractErrorMessage(error, '创建同行房间失败'),
        showCancel: false,
        confirmText: '知道了',
      });
    } finally {
      wx.hideLoading();
    }
  },

  handlePrivacyAgree() {
    resolvePrivacyAuthorization(this);
  },

  handlePrivacyReject() {
    rejectPrivacyAuthorization(this);
  },

  handleOpenPrivacyContract() {
    openPrivacyContract().catch(() => {
      wx.showToast({ title: '暂时无法打开隐私指引', icon: 'none' });
    });
  },
});

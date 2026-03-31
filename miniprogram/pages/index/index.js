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
const { generateCombinedTheme, generateRandomTheme, generateTheme, getLocationContext } = require('../../services/theme');
const { getBackendProvider } = require('../../services/api');

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

function buildSearchResultViews(results) {
  return (results || []).slice(0, 5).map((item, index) => ({
    id: item.id || item.location || `${item.name || item.address || 'result'}-${index}`,
    name: item.name || item.address || item.district || '推荐地点',
    address: item.address || item.district || '',
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
    location && location.placeName,
    location && location.name,
    contextResponse && contextResponse.placeName,
    amapSummary && amapSummary.placeName,
    amapSummary && amapSummary.pois && amapSummary.pois[0] && amapSummary.pois[0].name,
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
    address: item.address || '把这片街区继续展开成新的漫步线索',
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
    locationContext: '城市街道',
    locationAddress: '',
    latitude: null,
    longitude: null,
    mapCenterLatitude: null,
    mapCenterLongitude: null,
    mapScale: 14,
    mapMarkers: [],
    mapCircles: [],
    isMapDragging: false,
    walkMode: 'pure',
    isGenerating: false,
    searchKeyword: '',
    searchResults: [],
    loadingSearch: false,
    nearbyPlaces: [],
    nearbyExpanded: false,
    loadingNearbyPlaces: false,
    supportsNearbyPois: false,
  },

  onLoad() {
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
      supportsNearbyPois: getBackendProvider() === 'web',
    });
    app.globalData.currentTheme = currentTheme;
    this.syncDisplayMeta(currentTheme, 'preset', 'pure');
  },

  onReady() {
    this.mapCtx = wx.createMapContext('explore-map', this);
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
    const regeo = await getRegeo(location).catch(() => null);
    const amapSummary = normalizeAmapLocation(regeo, location.placeName || location.name || location.address);
    const contextResponse = await getLocationContext({
      latitude: location.latitude,
      longitude: location.longitude,
      placeName: amapSummary.placeName || location.placeName || location.name || location.address,
      address: amapSummary.address || location.address || '',
    }).catch(() => ({}));
    const displayLocationName = pickBestLocationName({
      location,
      amapSummary,
      contextResponse,
    });
    this.setData({
      latitude: location.latitude,
      longitude: location.longitude,
      locationName: displayLocationName,
      locationContext: contextResponse.context || amapSummary.district || '城市街道',
      locationAddress: amapSummary.address || location.address || '',
      searchResults: [],
      ...this.buildMapState({
        latitude: location.latitude,
        longitude: location.longitude,
        placeName: displayLocationName || location.name || '已选地点',
      }),
      nearbyPlaces: [],
      nearbyExpanded: false,
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
      wx.showLoading({ title: '定位中' });
      const result = await getCurrentLocation();
      await this.enrichLocation(result);
    } catch (error) {
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
    const latitude = Number(this.data.mapCenterLatitude);
    const longitude = Number(this.data.mapCenterLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      wx.showToast({ title: '先拖动地图选择位置', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '分析地点' });
    try {
      await this.enrichLocation({
        latitude,
        longitude,
        name: '地图选点',
        address: '',
      });
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
      this.setData({ searchResults });

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
    wx.showLoading({ title: '确认地点' });
    try {
      await this.enrichLocation(item);
      this.setData({ searchKeyword: item.name });
    } finally {
      wx.hideLoading();
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
      const result = await generateTheme({
        mood: this.data.mood,
        weather: this.data.weather,
        season: this.data.season,
        preference: this.data.preference,
        locationName: this.data.locationName,
        locationContext: this.data.locationContext,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        walkMode: this.data.walkMode,
        selectedThemes: buildSelectedThemeCategories(this.data.combineSelections),
      });
      const currentTheme = trimTheme({ ...result.theme, allMissions: result.theme.missions, locationName: this.data.locationName }, this.data.walkMode);
      this.setData({ currentTheme });
      app.globalData.currentTheme = currentTheme;
      this.syncDisplayMeta(currentTheme, result.source || 'rag-fallback');
    } catch (error) {
      wx.showToast({ title: '主题生成失败', icon: 'none' });
    } finally {
      this.setData({ isGenerating: false });
    }
  },

  async handleRandomTheme() {
    this.setData({ isGenerating: true });
    try {
      const selectedCategories = buildSelectedThemeCategories(this.data.combineSelections);
      const categoryPool = selectedCategories.length ? selectedCategories : this.data.randomCategories;
      const category = categoryPool[Math.floor(Math.random() * categoryPool.length)];
      const result = await generateRandomTheme({
        category,
        locationName: this.data.locationName,
        locationContext: this.data.locationContext,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        walkMode: this.data.walkMode,
        selectedThemes: selectedCategories,
      });
      const currentTheme = trimTheme({ ...result.theme, allMissions: result.theme.missions, locationName: this.data.locationName }, this.data.walkMode);
      this.setData({ currentTheme });
      app.globalData.currentTheme = currentTheme;
      this.syncDisplayMeta(currentTheme, result.source || 'random-fallback');
    } catch (error) {
      wx.showToast({ title: '随机主题失败', icon: 'none' });
    } finally {
      this.setData({ isGenerating: false });
    }
  },

  async handleCombinedTheme() {
    if (this.data.combineSelections.length < 1) {
      wx.showToast({ title: '请先选择 1-2 个主题', icon: 'none' });
      return;
    }

    this.setData({ isCombining: true });
    try {
      const result = await generateCombinedTheme({
        categories: this.data.combineSelections,
        locationName: this.data.locationName,
        locationContext: this.data.locationContext,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        walkMode: this.data.walkMode,
      });
      const currentTheme = trimTheme({ ...result.theme, allMissions: result.theme.missions, locationName: this.data.locationName }, this.data.walkMode);
      this.setData({ currentTheme });
      app.globalData.currentTheme = currentTheme;
      this.syncDisplayMeta(currentTheme, result.source || 'combined-fallback');
    } catch (error) {
      wx.showToast({ title: '组合主题失败', icon: 'none' });
    } finally {
      this.setData({ isCombining: false });
    }
  },

  handleStartWalk() {
    if (!this.data.currentTheme) {
      return;
    }

    app.globalData.currentTheme = this.data.currentTheme;
    const draft = {
      ...app.globalData.walkDraft,
      completedMissions: [],
      startedAt: Date.now(),
      locationName: this.data.locationName,
      locationContext: this.data.locationContext,
      locationAddress: this.data.locationAddress,
      latitude: this.data.latitude,
      longitude: this.data.longitude,
      missionReviews: {},
      selectedMission: this.data.currentTheme.missions[0] || '',
      noteText: '',
      photoList: [],
      videoList: [],
      audioList: [],
      routePoints: [],
      walkMode: this.data.walkMode,
      generationSource: this.data.currentThemeSource,
      isPublic: false,
    };
    app.setWalkDraft(draft);
    wx.navigateTo({ url: '/pages/record/record' });
  },
});

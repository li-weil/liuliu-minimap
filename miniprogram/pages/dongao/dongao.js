const { recommendSpots, generateMission } = require('../../services/dongao');
const config = require('../../utils/config');
const userTags = require('../../utils/userTags');

const REFRESH_INTERVAL_MS = 30000;
const GENERATION_STEPS = [
  { key: 'spot', label: '读取景点' },
  { key: 'weather', label: '整理天气' },
  { key: 'mission', label: '生成任务' },
];

// Hardcoded spot list for debug location picker (name + coords)
const DEBUG_SPOTS = [
  { n:"小竹湾沙滩", c:"113.702558,22.025959" },{ n:"月伴湾（大竹湾沙滩）", c:"113.706455,22.02521" },
  { n:"听涛步道", c:"113.721752,22.027634" },{ n:"灵犀台", c:"113.71744,22.029065" },
  { n:"仙鹊桥", c:"113.718806,22.029352" },{ n:"将军石林", c:"113.721741,22.026729" },
  { n:"铳城", c:"113.721045,22.024948" },{ n:"烽火台", c:"113.721297,22.024500" },
  { n:"东澳岛海关遗址", c:"113.719920,22.024427" },{ n:"摩崖石刻", c:"113.716646,22.021648" },
  { n:"水手房遗址", c:"113.719665,22.023909" },{ n:"映月滩", c:"113.718855,22.023563" },
  { n:"东澳湾", c:"113.713536,22.017373" },{ n:"婚礼堂", c:"113.696811,22.021783" },
  { n:"蜜月阁", c:"113.700040,22.021650" },{ n:"森林栈道", c:"113.698689,22.022294" },
  { n:"心心相印", c:"113.698871,22.023401" },{ n:"斜行电梯", c:"113.698773,22.022203" },
  { n:"观海亭", c:"113.698489,22.02068" },{ n:"观月亭", c:"113.701011,22.019421" },
  { n:"滨海栈道", c:"113.701571,22.018294" },{ n:"南沙湾沙滩", c:"113.705085,22.018745" },
  { n:"月牙环", c:"113.704917,22.018557" },{ n:"东澳湾沙滩", c:"113.713536,22.017373" },
  { n:"音乐阶梯", c:"113.71386,22.01695" },{ n:"万觅书店", c:"113.714008,22.017000" },
  { n:"大王庙", c:"113.716481,22.018602" },{ n:"万山海洋生物科普馆", c:"113.712819,22.017317" },
  { n:"风车山", c:"113.711937,22.024095" },{ n:"求子泉", c:"113.710299,22.020329" },
  { n:"揽海台", c:"113.715349,22.009314" },{ n:"开心石", c:"113.721859,22.021531" },
  { n:"罗刀湾石滩", c:"113.723084,22.021499" },{ n:"山海经书屋", c:"113.725625,22.021175" },
  { n:"飞鹰驿站", c:"113.719539,22.011468" },{ n:"叠石", c:"113.719356,22.011191" },
  { n:"夕阳驿站", c:"113.708201,22.011768" },{ n:"东澳岛旅游度假区", c:"113.712927,22.019270" },
  { n:"东澳岛蜜月山风景区", c:"113.698796,22.022256" },{ n:"东澳岛-观海平台", c:"113.725794,22.021320" },
  { n:"东澳岛-海龙泉", c:"113.718080,22.023159" },{ n:"东澳岛-风荡石", c:"113.717052,22.022009" },
  { n:"东澳岛-石景长廊", c:"113.716267,22.020814" },{ n:"东澳岛-双豚出海", c:"113.716664,22.021403" },
  { n:"东澳岛-自在佛", c:"113.719937,22.023994" },{ n:"钻石银滩(南沙湾)", c:"113.704710,22.018668" },
  { n:"东澳湾灯桩", c:"113.715989,22.020312" },{ n:"东澳岛蜜月山景区山海云道", c:"113.704251,22.020812" },
  { n:"万海平波", c:"113.716655,22.021730" },{ n:"观月台", c:"113.701011,22.019421" },
  { n:"东澳岛-铳城亭", c:"113.721045,22.024948" },{ n:"街心公园", c:"113.714679,22.019882" },
];

Page({
  data: {
    phase: 'ready',
    currentCard: null,
    generatingSpotName: '',
    recommendList: [],
    eliminatedNames: [],
    historyCards: [],
    cardIndex: 0,
    weatherLine: '',
    showDevTools: false,
    devLog: '',
    devModelInputText: '',
    devModelOutputText: '',
    devDebugTitle: '',
    devDebugText: '',
    showDebugDetail: false,
    errorMsg: '',
    debugSpotIndex: -1,
    debugSpotName: '',
    allSpotNames: [],
    locationModeLabel: '未定位',
    cardMotion: '',
    mapSelectedId: '',
    generationProgress: 0,
    generationStepIndex: 0,
    generationSteps: GENERATION_STEPS,
  },

  onLoad() {
    this.setData({ allSpotNames: DEBUG_SPOTS.map(s => s.n) });
  },

  onShow() {
    // 首次使用先做完四道选择题再进主流程
    if (!userTags.isOnboardingDone()) {
      wx.navigateTo({ url: '/pages/onboarding/onboarding' });
    }
  },

  onUnload() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    this._stopGenerationLoading();
    if (this._cardMotionTimer) {
      clearTimeout(this._cardMotionTimer);
      this._cardMotionTimer = null;
    }
    if (this._cardMotionClearTimer) {
      clearTimeout(this._cardMotionClearTimer);
      this._cardMotionClearTimer = null;
    }
  },

  async startFlow() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    this.setData({ phase: 'locating', errorMsg: '' });
    try {
      const loc = await this.getLocation();
      this._lastRecommendLoc = loc;
      const { spots } = await recommendSpots(loc.latitude, loc.longitude);
      if (!spots || spots.length === 0) {
        wx.showToast({ title: '暂无景点数据', icon: 'none' });
        this.setData({ phase: 'ready' });
        return;
      }
      this.setData({ recommendList: spots, eliminatedNames: [] });
      this._startRefreshTimer();
      await this.generateAndShow(spots[0]);
    } catch (err) {
      console.error('startFlow error:', err);
      this.setData({
        phase: 'ready',
        errorMsg: err.message || '请先部署云函数并初始化spots集合',
        showDevTools: true,
      });
      this.log('启动失败: ' + (err.message || '未知错误'));
    }
  },

  getLocation() {
    // Debug: use selected spot as location
    const { debugSpotIndex } = this.data;
    if (debugSpotIndex >= 0 && DEBUG_SPOTS[debugSpotIndex]) {
      const [lng, lat] = DEBUG_SPOTS[debugSpotIndex].c.split(',').map(Number);
      return Promise.resolve({ latitude: lat, longitude: lng });
    }

    return new Promise((resolve, reject) => {
      wx.getLocation({
        type: 'gcj02',
        success: resolve,
        fail: () => {
          reject(new Error('定位失败，请手动授权定位或选择岛上景点模拟位置'));
        },
      });
    });
  },

  async generateAndShow(spot) {
    this._startGenerationLoading(spot);
    try {
      const result = await generateMission(spot.map_name);
      this._stopGenerationLoading();
      this._cacheModelDebug(result.debug);
      const card = {
        mission: result.mission,
        tips: result.tips,
        safetyNote: result.safetyNote,
        spotName: spot.map_name,
        distance: spot.distance ? `${Math.round(spot.distance)}m` : '',
        coords: spot.coords,
        lat: spot.lat,
        lng: spot.lng,
      };
      const historyCards = [card, ...this.data.historyCards];
      this.setData({
        currentCard: card,
        historyCards,
        cardIndex: 0,
        phase: 'ready',
        generationProgress: 100,
        generationStepIndex: GENERATION_STEPS.length - 1,
        generatingSpotName: '',
        cardMotion: 'card-enter-left',
      });
      this._clearCardMotionSoon();
    } catch (err) {
      this._stopGenerationLoading();
      console.error('generateAndShow error:', err);
      wx.showToast({ title: '生成失败，请重试', icon: 'none' });
      this.setData({ phase: 'ready', generatingSpotName: '' });
    }
  },

  _startRefreshTimer() {
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._refreshTimer = setInterval(async () => {
      try {
        const loc = this._lastRecommendLoc;
        if (!loc) return;
        const { spots } = await recommendSpots(loc.latitude, loc.longitude, this.data.eliminatedNames);
        if (spots && spots.length > 0) {
          this.setData({ recommendList: spots });
        }
      } catch (e) { /* silent */ }
    }, REFRESH_INTERVAL_MS);
  },

  // Touch handling for swipe
  onTouchStart(e) {
    this._touchStartX = e.touches[0].clientX;
  },

  onTouchEnd(e) {
    const deltaX = e.changedTouches[0].clientX - (this._touchStartX || 0);
    const threshold = 60;
    if (Math.abs(deltaX) < threshold) return;

    if (deltaX < 0) {
      if (this.data.cardIndex === 0) {
        this.onSwipeLeftNew();
      } else {
        this.onSwipeLeftBack();
      }
    } else {
      this.onSwipeRightHistory();
    }
  },

  onSwipeLeftNew() {
    if (this.data.phase !== 'ready') return;
    this.setData({ phase: 'choosing' });
  },

  async onNewMission() {
    const spot = this.data.recommendList.find(
      s => s.map_name === this.data.currentCard.spotName
    );
    if (spot) {
      await this.generateAndShow(spot);
    } else {
      const next = this.data.recommendList[0];
      if (next) await this.generateAndShow(next);
    }
  },

  async onNewSpot() {
    const eliminatedNames = [...this.data.eliminatedNames, this.data.currentCard.spotName];
    const nextSpot = this.data.recommendList.find(
      s => !eliminatedNames.includes(s.map_name)
    );
    if (!nextSpot) {
      wx.showToast({ title: '附近没有更多景点了', icon: 'none' });
      this.setData({ phase: 'ready' });
      return;
    }
    this.setData({ eliminatedNames });
    await this.generateAndShow(nextSpot);
  },

  onSwipeRightHistory() {
    if (this.data.phase !== 'ready') return;
    const nextIndex = this.data.cardIndex + 1;
    if (nextIndex >= this.data.historyCards.length) {
      wx.showToast({ title: '没有更早的卡片了', icon: 'none' });
      return;
    }
    this._animateCardSwitch('right', {
      cardIndex: nextIndex,
      currentCard: this.data.historyCards[nextIndex],
    });
  },

  onSwipeLeftBack() {
    const prevIndex = this.data.cardIndex - 1;
    if (prevIndex < 0) return;
    this._animateCardSwitch('left', {
      cardIndex: prevIndex,
      currentCard: this.data.historyCards[prevIndex],
    });
  },

  onCancelChoose() {
    this.setData({ phase: 'ready' });
  },

  onNavigateToSpot() {
    const card = this.data.currentCard;
    if (!card || !card.lat || !card.lng) return;
    wx.openLocation({
      latitude: card.lat,
      longitude: card.lng,
      name: card.spotName,
      scale: 16,
    });
  },

  onStartWalk() {
    const card = this.data.currentCard;
    if (!card || !card.mission || this.data.phase !== 'ready') return;
    const app = getApp();
    app.globalData.currentTheme = {
      title: card.spotName,
      category: '东澳岛景点',
      missions: [card.mission],
    };
    app.setWalkDraft({
      walkId: '',
      walkMode: 'dongao',
      themeTitle: card.spotName,
      themeSnapshot: {
        title: card.spotName,
        category: '东澳岛景点',
        missions: [card.mission],
      },
      locationName: card.spotName,
      latitude: card.lat,
      longitude: card.lng,
      generationSource: 'dongao-scenic-spot',
    });
    wx.navigateTo({ url: '/pages/record/record' });
  },

  // === Dev tools ===

  toggleDevTools() {
    this.setData({ showDevTools: !this.data.showDevTools });
  },

  showModelInput() {
    this._showDebugText('模型原始输入', this.data.devModelInputText);
  },

  showModelOutput() {
    this._showDebugText('模型原始输出', this.data.devModelOutputText);
  },

  closeDebugDetail() {
    this.setData({ showDebugDetail: false });
  },

  noop() {},

  log(msg) {
    const time = new Date().toLocaleTimeString();
    this.setData({ devLog: `[${time}] ${msg}\n` + (this.data.devLog || '') });
  },

  async devInitSpots() {
    this.log('初始化 spots 集合...');
    wx.showLoading({ title: '初始化中' });
    try {
      const res = await wx.cloud.callFunction({ name: 'initDongaoSpots' });
      wx.hideLoading();
      this.log('完成: ' + JSON.stringify(res.result));
      wx.showToast({ title: '初始化完成', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      this.log('失败: ' + err.message);
      wx.showToast({ title: '初始化失败', icon: 'error' });
    }
  },

  async devTestRecommend() {
    this.log('测试推荐...');
    wx.showLoading({ title: '查询中' });
    try {
      const loc = await this.getLocation();
      const { spots } = await recommendSpots(loc.latitude, loc.longitude);
      wx.hideLoading();
      this.setData({ recommendList: spots, eliminatedNames: [] });
      const names = spots.slice(0, 5).map((s, index) => {
        const rank = s.sortRank || index + 1;
        const distance = Number.isFinite(Number(s.distance)) ? `${Math.round(Number(s.distance))}m` : '未知距离';
        const source = s.distanceSource === 'database' ? 'db' : 'calc';
        return `#${rank} ${s.map_name}(${distance}/${source})`;
      }).join(', ');
      this.log('数据库推荐顺序: ' + names);
      wx.showToast({ title: `找到 ${spots.length} 个景点`, icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      this.log('失败: ' + err.message);
      wx.showToast({ title: '推荐失败', icon: 'error' });
    }
  },

  onDebugSpotChange(e) {
    const index = parseInt(e.detail.value);
    const spot = DEBUG_SPOTS[index];
    if (!spot) return;
    this.setData({
      debugSpotIndex: index,
      debugSpotName: spot.n,
      locationModeLabel: '模拟位置',
      eliminatedNames: [],
    });
    this.log('模拟定位: ' + spot.n + ' (' + spot.c + ')');
    this.startFlow();
  },

  onMapPointTap(e) {
    const detail = e.detail || {};
    const index = DEBUG_SPOTS.findIndex(s => s.n === detail.spotName);
    if (index < 0) {
      wx.showToast({ title: '该点位暂无任务数据', icon: 'none' });
      return;
    }
    this.setData({
      debugSpotIndex: index,
      debugSpotName: detail.spotName,
      locationModeLabel: '模拟位置',
      eliminatedNames: [],
      mapSelectedId: detail.id,
    });
    this.log('地图选点: ' + detail.title + ' (' + detail.spotName + ')');
    this.startFlow();
  },

  onOpenIsland3d() {
    const url = String(config.island3dUrl || '').trim();
    if (!url) {
      wx.showToast({ title: '3D 云游链接还未配置', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: url,
      success: () => {
        wx.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none' });
      },
    });
  },

  _startGenerationLoading(spot) {
    this._stopGenerationLoading();
    this.setData({
      phase: 'loading',
      generatingSpotName: spot && spot.map_name ? spot.map_name : '',
      generationProgress: 18,
      generationStepIndex: 0,
    });
    const progressFrames = [
      { progress: 42, step: 1 },
      { progress: 68, step: 1 },
      { progress: 86, step: 2 },
    ];
    let frameIndex = 0;
    this._generationTimer = setInterval(() => {
      const frame = progressFrames[Math.min(frameIndex, progressFrames.length - 1)];
      this.setData({
        generationProgress: frame.progress,
        generationStepIndex: frame.step,
      });
      frameIndex += 1;
    }, 900);
  },

  _stopGenerationLoading() {
    if (this._generationTimer) {
      clearInterval(this._generationTimer);
      this._generationTimer = null;
    }
  },

  _animateCardSwitch(direction, nextData) {
    const exitClass = direction === 'left' ? 'card-exit-left' : 'card-exit-right';
    const enterClass = direction === 'left' ? 'card-enter-left' : 'card-enter-right';
    if (this._cardMotionTimer) clearTimeout(this._cardMotionTimer);
    if (this._cardMotionClearTimer) clearTimeout(this._cardMotionClearTimer);
    this.setData({ cardMotion: exitClass });
    this._cardMotionTimer = setTimeout(() => {
      this.setData({
        ...nextData,
        cardMotion: enterClass,
      });
      this._clearCardMotionSoon();
    }, 130);
  },

  _clearCardMotionSoon() {
    if (this._cardMotionClearTimer) clearTimeout(this._cardMotionClearTimer);
    this._cardMotionClearTimer = setTimeout(() => {
      this.setData({ cardMotion: '' });
    }, 260);
  },

  devClearDebug() {
    this.setData({
      debugSpotIndex: -1,
      debugSpotName: '',
      locationModeLabel: '真实定位',
      eliminatedNames: [],
    });
    this.log('手动触发真实GPS定位');
    this.startFlow();
  },

  async devCreateIndex() {
    this.log('创建 geo 索引...');
    wx.showLoading({ title: '创建索引中' });
    try {
      const res = await wx.cloud.callFunction({ name: 'ensureSpotsIndex' });
      wx.hideLoading();
      this.log('索引已创建: ' + JSON.stringify(res.result));
      wx.showToast({ title: '索引创建成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      this.log('失败: ' + err.message);
    }
  },

  async devTestRefreshData() {
    this.log('测试天气/潮汐刷新...');
    wx.showLoading({ title: '刷新中' });
    try {
      const res = await wx.cloud.callFunction({ name: 'dongaoRefreshData' });
      wx.hideLoading();
      const result = res && res.result ? res.result : {};
      const weather = result.weather || {};
      const tide = result.tide || {};
      const errors = Array.isArray(result.errors) ? result.errors : [];
      this.log(
        '刷新结果: '
        + `weather=${weather.ok ? `OK ${weather.hourlyCount || 0}h` : 'FAIL'}, `
        + `tide=${tide.ok ? `OK ${tide.hourlyCount || 0}h` : 'FAIL'}`
        + (errors.length ? `, errors=${JSON.stringify(errors)}` : '')
      );
      if (weather.ok) {
        const now = weather.currentHourForecast || {};
        const realtime = weather.realtime || {};
        this.log(
          `天气源=${weather.provider || '未知'} source=${weather.source || '未知'} `
          + `location=${weather.location || '未知'} key=${weather.locationKey || '未知'}`
        );
        this.log(
          `天气样本: 实况${realtime.weather || '未知'} ${realtime.temp !== undefined ? `${realtime.temp}°C` : ''}; `
          + `当前小时${now.time || now.datetime || '未知'} ${now.weather || '未知'} `
          + `${now.temp !== undefined ? `${now.temp}°C` : ''} `
          + `降水概率${now.precipitation_probability !== undefined ? `${now.precipitation_probability}%` : '未知'}`
        );
      }
      wx.showToast({ title: result.ok ? '刷新完成' : '刷新有失败项', icon: result.ok ? 'success' : 'none' });
    } catch (err) {
      wx.hideLoading();
      this.log('刷新失败: ' + (err.message || err.errMsg || '未知错误'));
      wx.showToast({ title: '刷新失败', icon: 'error' });
    }
  },

  async devTestGenerate() {
    this.log('测试生成...');
    wx.showLoading({ title: '生成中' });
    try {
      const loc = await this.getLocation();
      const { spots } = await recommendSpots(loc.latitude, loc.longitude);
      if (!spots || !spots.length) {
        wx.hideLoading();
        this.log('失败: 无景点数据');
        return;
      }
      const result = await generateMission(spots[0].map_name);
      wx.hideLoading();
      this._cacheModelDebug(result.debug);
      this.log(`${spots[0].map_name}: ${result.mission}`);
      wx.showToast({ title: '生成完成', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      this.log('失败: ' + err.message);
      wx.showToast({ title: '生成失败', icon: 'error' });
    }
  },

  _cacheModelDebug(debug) {
    if (!debug) return;
    const input = debug.modelInput || {};
    const output = debug.modelOutput || {};
    this.setData({
      devModelInputText: JSON.stringify(input, null, 2),
      devModelOutputText: JSON.stringify(output, null, 2),
    });
  },

  _showDebugText(title, text) {
    if (!text) {
      wx.showToast({ title: '先生成一次任务', icon: 'none' });
      return;
    }
    this.setData({
      devDebugTitle: title,
      devDebugText: text,
      showDebugDetail: true,
    });
  },
});

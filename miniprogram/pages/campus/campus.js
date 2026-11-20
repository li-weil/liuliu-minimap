const { recommendSpots, generateMission } = require('../../services/campus');

const REFRESH_INTERVAL_MS = 30000;
const GENERATION_STEPS = [
  { key: 'spot', label: '读取地点' },
  { key: 'guide', label: '判断开放' },
  { key: 'mission', label: '生成任务' },
];

const THEMES = [
  { key: '美食', name: '美食', desc: '去吃点好的' },
  { key: '历史', name: '历史', desc: '听听校园故事' },
  { key: '景点', name: '景点', desc: '看看中珠风景' },
];

// 模拟位置列表（29 个点位，name + coords，与 campusSpots 一致）
const DEBUG_SPOTS = [
  { n: '教学楼A区', c: '113.589140,22.346977' }, { n: '教学楼B区', c: '113.589060,22.347297' },
  { n: '教学楼C区', c: '113.588878,22.348081' }, { n: '教学楼D区', c: '113.588892,22.348657' },
  { n: '教学楼E区', c: '113.588940,22.349633' }, { n: '教学楼F区', c: '113.588934,22.350091' },
  { n: '图书馆', c: '113.589166,22.344125' }, { n: '体育馆', c: '113.592328,22.349502' },
  { n: '海琴楼群', c: '113.593973,22.344893' }, { n: '地质矿物博物馆', c: '113.594456,22.344964' },
  { n: '珠海海洋科普中心', c: '113.593859,22.344851' }, { n: '天琴中心', c: '113.576852,22.350874' },
  { n: '瀚林楼群', c: '113.584061,22.349319' }, { n: '海滨红楼', c: '113.584275,22.349875' },
  { n: '音乐厅', c: '113.587581,22.346047' }, { n: '国际交流中心', c: '113.593835,22.341965' },
  { n: '隐湖', c: '113.587902,22.347917' }, { n: '琴湖', c: '113.577833,22.351345' },
  { n: '若海', c: '113.591699,22.345391' }, { n: '若海餐厅', c: '113.592110,22.342561' },
  { n: '槿园食堂', c: '113.592260,22.350406' }, { n: '榕园食堂', c: '113.582597,22.351601' },
  { n: '荔园食堂', c: '113.587655,22.351922' }, { n: '教学楼咖啡饮品', c: '113.589126,22.347081' },
  { n: '荔园咖啡饮品', c: '113.585257,22.350862' }, { n: '孙中山铜像', c: '113.590419,22.349362' },
  { n: '校训石', c: '113.590747,22.348778' }, { n: '槿园运动场', c: '113.590238,22.351151' },
  { n: '游泳池', c: '113.579812,22.350437' },
];

const THEME_EMPTY_COPY = {
  美食: '选「美食」，生成一条校园美食任务',
  历史: '选「历史」，生成一条校园历史任务',
  景点: '选「景点」，生成一条校园游览任务',
};

Page({
  data: {
    phase: 'ready',
    themes: THEMES,
    selectedTheme: '',
    currentCard: null,
    lastTask: '',
    generatingSpotName: '',
    recommendList: [],
    eliminatedNames: [],
    historyCards: [],
    cardIndex: 0,
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
    generationProgress: 0,
    generationStepIndex: 0,
    generationSteps: GENERATION_STEPS,
    themeEmptyCopy: '',
  },

  onLoad() {
    this.setData({ allSpotNames: DEBUG_SPOTS.map((s) => s.n) });
  },

  onUnload() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    this._stopGenerationLoading();
    if (this._cardMotionTimer) clearTimeout(this._cardMotionTimer);
    if (this._cardMotionClearTimer) clearTimeout(this._cardMotionClearTimer);
  },

  // === 主题选择 ===

  onSelectTheme(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.selectedTheme) return;
    this.setData({
      selectedTheme: key,
      themeEmptyCopy: THEME_EMPTY_COPY[key] || '',
      recommendList: [],
      eliminatedNames: [],
      historyCards: [],
      cardIndex: 0,
      currentCard: null,
      errorMsg: '',
    });
    this.startFlow();
  },

  async startFlow() {
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
    const { selectedTheme } = this.data;
    if (!selectedTheme) return;
    this.setData({ phase: 'locating', errorMsg: '' });
    try {
      const loc = await this.getLocation();
      this._lastRecommendLoc = loc;
      const { spots } = await recommendSpots(loc.latitude, loc.longitude, selectedTheme);
      if (!spots || spots.length === 0) {
        wx.showToast({ title: '这个主题附近暂时没有点位', icon: 'none' });
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
        errorMsg: err.message || '请先部署云函数并初始化 campusSpots 集合',
        showDevTools: true,
      });
      this.log('启动失败: ' + (err.message || '未知错误'));
    }
  },

  getLocation() {
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
          reject(new Error('定位失败，请手动授权定位或选择模拟位置'));
        },
      });
    });
  },

  async generateAndShow(spot) {
    this._startGenerationLoading(spot);
    try {
      const result = await generateMission(spot.map_name, this.data.selectedTheme, this.data.lastTask);
      this._stopGenerationLoading();
      this._cacheModelDebug(result.debug);
      const card = {
        mainTask: result.mainTask,
        sensoryTask: result.sensoryTask,
        tips: result.tips,
        safetyNote: result.safetyNote,
        spotName: spot.map_name,
        distance: spot.distance ? `${Math.round(spot.distance)}m` : '',
        coords: spot.coords,
        lat: spot.lat,
        lng: spot.lng,
        tag: this.data.selectedTheme,
      };
      const historyCards = [card, ...this.data.historyCards];
      this.setData({
        currentCard: card,
        historyCards,
        cardIndex: 0,
        lastTask: result.mainTask,
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
        const { spots } = await recommendSpots(loc.latitude, loc.longitude, this.data.selectedTheme, this.data.eliminatedNames);
        if (spots && spots.length > 0) {
          this.setData({ recommendList: spots });
        }
      } catch (e) { /* silent */ }
    }, REFRESH_INTERVAL_MS);
  },

  // === 滑动切换 ===

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
      (s) => s.map_name === this.data.currentCard.spotName
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
      (s) => !eliminatedNames.includes(s.map_name)
    );
    if (!nextSpot) {
      wx.showToast({ title: '附近没有更多点位了', icon: 'none' });
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
    const { selectedTheme } = this.data;
    if (!card || !card.mainTask || this.data.phase !== 'ready' || !selectedTheme) return;
    const themeName = (THEMES.find((t) => t.key === selectedTheme) || {}).name || selectedTheme;
    const missions = [card.mainTask];
    if (card.sensoryTask && card.sensoryTask.name) {
      missions.push(`${card.sensoryTask.name}：${card.sensoryTask.description}`);
    }
    const app = getApp();
    app.globalData.currentTheme = {
      title: card.spotName,
      category: `校园导览·${themeName}`,
      missions,
    };
    app.setWalkDraft({
      walkId: '',
      walkMode: 'campus',
      themeTitle: card.spotName,
      themeSnapshot: {
        title: card.spotName,
        category: `校园导览·${themeName}`,
        missions,
      },
      locationName: card.spotName,
      latitude: card.lat,
      longitude: card.lng,
      generationSource: `campus-${selectedTheme}`,
    });
    wx.navigateTo({ url: '/pages/record/record' });
  },

  // === Dev tools（精简版）===

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
    this.log('初始化 campusSpots 集合...');
    wx.showLoading({ title: '初始化中' });
    try {
      const res = await wx.cloud.callFunction({ name: 'initCampusSpots' });
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
      const { spots } = await recommendSpots(loc.latitude, loc.longitude, this.data.selectedTheme);
      wx.hideLoading();
      this.setData({ recommendList: spots, eliminatedNames: [] });
      const names = spots.slice(0, 5).map((s) => `#${s.sortRank} ${s.map_name}(${Number.isFinite(Number(s.distance)) ? `${Math.round(Number(s.distance))}m` : '未知距离'})`).join(', ');
      this.log(`推荐(${this.data.selectedTheme || '全部'}): ${names}`);
      wx.showToast({ title: `找到 ${spots.length} 个点位`, icon: 'success' });
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

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
const { getLocationContext, searchLocations } = require('../../services/map');
const { createTeamRoom } = require('../../services/team');
const { generateCombinedTheme, generateTheme } = require('../../services/theme');
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

function normalizeCombineSelections(selected, walkMode) {
  const limit = walkMode === 'pure' ? 1 : 2;
  return Array.isArray(selected) ? selected.filter(Boolean).slice(0, limit) : [];
}

function pickRandomThemeCategory(categoryPool) {
  const categories = Array.isArray(categoryPool) ? categoryPool.filter(Boolean) : [];
  if (!categories.length) {
    return '形状';
  }
  return String(categories[Math.floor(Math.random() * categories.length)]).replace(/漫步/g, '').trim() || '形状';
}

function normalizeGenerationThemeList(selectedThemes) {
  return (Array.isArray(selectedThemes) ? selectedThemes : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

const GENERATION_STAGE_SEQUENCE = ['confirm', 'gather', 'generate', 'finalize'];
const GENERATION_OVERTIME_COPY = '66 正在加速赶来，请耐心等待';
const GENERATION_ERROR_COPY = '66 迷路啦，请再次尝试生成';
const GENERATION_STAGE_META = {
  confirm: {
    key: 'confirm',
    index: 1,
    shortLabel: '确认位置',
    title: '正在确认探索点位置',
    progress: 14,
    durationMs: 1000,
    badge: '位置就绪前',
  },
  gather: {
    key: 'gather',
    index: 2,
    shortLabel: '整理线索',
    title: '正在整理附近地点和时间线索',
    progress: 38,
    durationMs: 1000,
    badge: '环境整理中',
  },
  generate: {
    key: 'generate',
    index: 3,
    shortLabel: '生成任务',
    title: '正在生成漫步主题和任务',
    progress: 78,
    durationMs: 5000,
    badge: 'AI 生成中',
  },
  finalize: {
    key: 'finalize',
    index: 4,
    shortLabel: '整理卡片',
    title: '正在整理任务卡片',
    progress: 100,
    durationMs: 1000,
    badge: '马上就好',
  },
};

function buildGenerationStepViews(currentStage, status = 'loading') {
  const currentIndex = Math.max(0, GENERATION_STAGE_SEQUENCE.indexOf(currentStage));
  return GENERATION_STAGE_SEQUENCE.map((stageKey, index) => {
    const meta = GENERATION_STAGE_META[stageKey];
    let state = 'pending';
    if (status === 'error') {
      state = index < currentIndex ? 'done' : index === currentIndex ? 'error' : 'pending';
    } else if (index < currentIndex) {
      state = 'done';
    } else if (index === currentIndex) {
      state = 'active';
    }
    return {
      key: stageKey,
      index: meta.index,
      label: meta.shortLabel,
      state,
    };
  });
}

function buildGenerationViewState({
  status = 'idle',
  stage = 'confirm',
  overtime = false,
  missionCount = 1,
  message = '',
  hint = '',
} = {}) {
  if (status === 'idle') {
    return null;
  }

  const stageKey = GENERATION_STAGE_META[stage] ? stage : 'confirm';
  const meta = GENERATION_STAGE_META[stageKey];

  if (status === 'error') {
    return {
      visible: true,
      status: 'error',
      glyph: '66',
      vibeColor: '#8f5b5b',
      kicker: '生成失败',
      title: GENERATION_ERROR_COPY,
      hint: message || hint || '这次没有顺利找到合适的漫步线索，可以直接再次点击生成。',
      badge: '请再试一次',
      progress: 100,
      progressTransitionMs: 320,
      progressLabel: '这次没有顺利完成，我们已经停在刚才的阶段，等你再次出发。',
      steps: buildGenerationStepViews(stageKey, 'error'),
      placeholderMissions: Array.from({ length: Math.max(1, Number(missionCount) || 1) }),
    };
  }

  return {
    visible: true,
    status: 'loading',
    glyph: '66',
    vibeColor: '#5a5a40',
    kicker: '生成中',
    title: meta.title,
    hint: overtime ? GENERATION_OVERTIME_COPY : '',
    badge: meta.badge,
    progress: meta.progress,
    progressTransitionMs: meta.durationMs,
    progressLabel: overtime ? GENERATION_OVERTIME_COPY : meta.title,
    steps: buildGenerationStepViews(stageKey, 'loading'),
    placeholderMissions: Array.from({ length: Math.max(1, Number(missionCount) || 1) }),
  };
}

function normalizeRandomSource(source) {
  const normalized = String(source || '').trim();
  if (normalized === 'ai-direct' || normalized === 'ai-direct-raw') {
    return 'random-direct';
  }
  if (normalized === 'ai-direct-fallback' || normalized === 'ai-direct-error') {
    return 'random-direct-fallback';
  }
  if (normalized === 'ai-direct-partial-fallback') {
    return 'random-direct-partial-fallback';
  }
  return normalized || 'random-direct-fallback';
}

function buildGeneratedThemeMeta(theme) {
  const normalizedTheme = theme && typeof theme === 'object' ? theme : {};
  return {
    generatedThemeCategory: String(normalizedTheme.category || '').trim(),
    generatedThemeTitle: String(normalizedTheme.title || '').trim(),
  };
}

function normalizeThemeSnapshotMeta(theme) {
  const normalizedTheme = theme && typeof theme === 'object' ? theme : null;
  if (!normalizedTheme) {
    return null;
  }
  const title = String(normalizedTheme.title || '').trim();
  const description = String(normalizedTheme.description || '').trim();
  const missions = dedupeStrings(
    Array.isArray(normalizedTheme.missions)
      ? normalizedTheme.missions
      : [],
    6
  );
  if (!title && !description && !missions.length) {
    return null;
  }
  return {
    title,
    description,
    missions,
  };
}

function normalizeGenerationStructureCheckMeta(structureCheck) {
  const normalized = structureCheck && typeof structureCheck === 'object' ? structureCheck : null;
  if (!normalized) {
    return null;
  }
  return {
    stage: normalized.stage ? String(normalized.stage).trim() : '',
    ok: !!normalized.ok,
    walkMode: String(normalized.walkMode || '').trim(),
    modeConfig: normalized.modeConfig && typeof normalized.modeConfig === 'object'
      ? normalized.modeConfig
      : null,
    categories: normalizeGenerationThemeList(normalized.categories || []),
    genericMissionCount: Number(normalized.genericMissionCount) || 0,
    varietyRatio: Number.isFinite(Number(normalized.varietyRatio)) ? Number(normalized.varietyRatio) : null,
    similarPairCount: Number(normalized.similarPairCount) || 0,
    insufficientMissionCount: !!normalized.insufficientMissionCount,
    lowScore: !!normalized.lowScore,
    score: Number.isFinite(Number(normalized.score)) ? Number(normalized.score) : null,
    reasons: dedupeStrings(normalized.reasons || [], 6),
  };
}

function buildStructureCheckSummary(generationSource, generationStructureCheck) {
  const source = String(generationSource || '').trim();
  const isDirectMode = /direct/.test(source);
  if (!generationSource) {
    return {
      status: '未生成',
      details: '尚未发起生成',
      score: '未提供',
      missingCategories: [],
      reasons: [],
    };
  }
  if (!generationStructureCheck) {
    return {
      status: '云函数未返回',
      details: '本次结果带有 source，但没有返回 structureCheck，通常表示当前云函数还是旧版本',
      score: isDirectMode ? '未启用' : 'AI 未提供',
      precheckScore: '未提供',
      missingCategories: [],
      reasons: [],
    };
  }

  const status = [
    generationStructureCheck.ok ? '通过' : '待修正',
    '结构检查',
  ].filter(Boolean).join(' · ');
  const details = [
    generationStructureCheck.genericMissionCount > 0 ? `泛化任务 ${generationStructureCheck.genericMissionCount} 条` : '任务不泛',
    generationStructureCheck.insufficientMissionCount ? '任务数量不足' : '',
    generationStructureCheck.similarPairCount > 0 ? `相似任务 ${generationStructureCheck.similarPairCount} 组` : '',
  ].filter(Boolean).join('；') || '未提供';

  return {
    status,
    details,
    score: Number.isFinite(Number(generationStructureCheck.score)) ? Number(generationStructureCheck.score) : '未提供',
    precheckScore: '未启用',
    missingCategories: generationStructureCheck.missingCategories || [],
    reasons: generationStructureCheck.reasons || [],
  };
}

function normalizeGenerationModelRequestMeta(modelRequest) {
  return modelRequest && typeof modelRequest === 'object' ? modelRequest : null;
}

function normalizeGenerationModelResponseMeta(modelResponse) {
  return modelResponse && typeof modelResponse === 'object' ? modelResponse : null;
}

function inferMissionActionType(text) {
  const mission = String(text || '');
  if (!mission) {
    return '';
  }
  const patterns = [
    ['停一下听', /停一下|停一停|先停|驻足|站一会/],
    ['分辨来源', /分辨|判断.*(?:从哪里来|来源)|听清.*(?:哪里|哪边)/],
    ['顺着找', /顺着|沿着|跟着/],
    ['等一下', /等一下|等一会|等下一次|等待/],
    ['回头再听', /回头/],
    ['换个位置', /换个位置|换个站位|换个角度|换个方向|绕到|退后|走近|走远/],
    ['比较', /比较|对照|差异/],
    ['先猜再确认', /先猜|再确认|核对|验证/],
    ['闻到后找来源', /闻|气味|味道|香气|潮气/],
    ['找一个规则', /规则|顺序|提示|线索/],
    ['找一处', /找一处|找一个|找到|寻找/],
    ['记录', /记录|记下|拍下/],
  ];
  const matched = patterns.find((item) => item[1].test(mission));
  return matched ? matched[0] : '';
}

function normalizeRecentMissionHistoryEntries(values, limit = 10) {
  const result = [];
  (Array.isArray(values) ? values : []).forEach((item) => {
    const entry = item && typeof item === 'object'
      ? item
      : { mission: item };
    const mission = String(entry.mission || entry.text || entry.label || '').trim();
    if (!mission || result.some((existing) => existing.mission === mission)) {
      return;
    }
    result.push({
      mission,
      title: String(entry.title || '').trim(),
      category: String(entry.category || '').trim(),
      actionType: String(entry.actionType || inferMissionActionType(mission)).trim(),
      anchor: String(entry.anchor || '').trim(),
      source: String(entry.source || '').trim(),
    });
  });
  return result.slice(0, limit);
}

function appendThemeToRecentMissionHistory(history, theme, source = '') {
  const currentTheme = theme && typeof theme === 'object' ? theme : {};
  const themeEntries = (Array.isArray(currentTheme.missions) ? currentTheme.missions : [])
    .map((mission) => String(mission || '').trim())
    .filter(Boolean)
    .map((mission) => ({
      mission,
      title: String(currentTheme.title || '').trim(),
      category: String(currentTheme.category || '').trim(),
      actionType: inferMissionActionType(mission),
      anchor: '',
      source: String(source || '').trim(),
    }));
  return normalizeRecentMissionHistoryEntries([].concat(themeEntries, history || []), 10);
}

function applyGeneratedThemeMetaToContext(generationContext, theme, source = '', structureCheck = null, runtimeVersion = '', errorReason = '', modelRequest = null, modelResponse = null) {
  const baseContext = generationContext && typeof generationContext === 'object' ? generationContext : {};
  const contextPacket = baseContext.contextPacket && typeof baseContext.contextPacket === 'object'
    ? baseContext.contextPacket
    : {};
  const userState = contextPacket.userState && typeof contextPacket.userState === 'object'
    ? contextPacket.userState
    : {};
  const generationPacket = contextPacket.generation && typeof contextPacket.generation === 'object'
    ? contextPacket.generation
    : {};
  const generatedThemeMeta = buildGeneratedThemeMeta(theme);
  const normalizedStructureCheck = normalizeGenerationStructureCheckMeta(structureCheck);
  const normalizedModelRequest = normalizeGenerationModelRequestMeta(modelRequest);
  const normalizedModelResponse = normalizeGenerationModelResponseMeta(modelResponse);
  const recentMissionHistory = appendThemeToRecentMissionHistory(generationPacket.recentMissionHistory || [], theme, source);
  return {
    ...baseContext,
    ...generatedThemeMeta,
    generationSource: source || baseContext.generationSource || '',
    generationStructureCheck: normalizedStructureCheck,
    generationModelRequest: normalizedModelRequest,
    generationModelResponse: normalizedModelResponse,
    generationErrorReason: String(errorReason || '').trim(),
    runtimeVersion: runtimeVersion || baseContext.runtimeVersion || '',
    contextPacket: {
      ...contextPacket,
      userState: {
        ...userState,
        ...generatedThemeMeta,
      },
      generation: {
        ...generationPacket,
        previousThemeTitle: String(theme && theme.title || '').trim(),
        previousMissions: Array.isArray(theme && theme.missions)
          ? theme.missions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
          : [],
        recentMissionHistory,
        errorReason: String(errorReason || '').trim(),
      },
      structureCheck: normalizedStructureCheck,
      modelRequest: normalizedModelRequest,
      modelResponse: normalizedModelResponse,
      runtimeVersion: runtimeVersion || contextPacket.runtimeVersion || '',
    },
  };
}

function inferSeasonFromDate(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) {
    return '春';
  }
  if (month >= 6 && month <= 8) {
    return '夏';
  }
  if (month >= 9 && month <= 11) {
    return '秋';
  }
  return '冬';
}

function resolveModeScopedGenerationFields(pageData = {}, timeContext = buildTimeContext()) {
  const walkMode = pageData.walkMode || 'pure';
  const currentSeason = inferSeasonFromDate(timeContext && timeContext.localTime ? new Date(timeContext.localTime.replace(' ', 'T')) : new Date());
  if (walkMode === 'pure') {
    return {
      mood: '',
      weather: '',
      season: currentSeason,
      preference: '',
    };
  }
  return {
    mood: pageData.mood || '',
    weather: pageData.weather || '',
    season: pageData.season || currentSeason,
    preference: pageData.preference || '',
  };
}

const TIME_PHASE_CONFIGS = [
  {
    label: '凌晨',
    startHour: 0,
    endHour: 4,
    hints: [
      '路上人很少，空间像被拉开，空地和路口会显得更大',
      '清扫、补货、值守、夜班交接这些痕迹更容易被看见',
      '亮着的窗口、便利店和路灯会比白天更有存在感',
      '声音来源更分散，脚步、风声、远处车流会被单独听出来',
      '街面节奏偏慢，但偶尔出现的移动会显得很突然',
      '任务应更保守、更安全，优先选择明亮、开放、有人值守的位置',
    ],
  },
  {
    label: '清晨',
    startHour: 5,
    endHour: 7,
    hints: [
      '地面可能还带着湿气，水痕、树影和晨光会把边界勾出来',
      '街道像刚被重新整理，卷闸门、早餐摊、晨练的人会慢慢出现',
      '空气通常更轻，食物香、草木味和冷空气更容易分开感受到',
      '声音还不密，鸟叫、清扫声、远处车辆声会各自占一块空间',
      '人流正在从零散变成连续，停留和穿行的转换特别明显',
      '适合观察“开始”的瞬间，比如开门、摆摊、亮灯、拉起卷帘',
    ],
  },
  {
    label: '上午',
    startHour: 8,
    endHour: 10,
    hints: [
      '通勤、上课、办事的人流更连续，路线感比停留感更强',
      '店铺和窗口正在进入工作状态，招牌、货架、门口动作都会变多',
      '街上的判断通常更快，人们更像是“路过并确认”而不是慢慢停下',
      '共享单车、外卖、取件、问路这些短暂停顿会频繁出现',
      '光线开始变硬，建筑立面、路边阴影和反光区域会更清楚',
      '适合观察“白天秩序是怎么启动起来的”',
    ],
  },
  {
    label: '午后',
    startHour: 11,
    endHour: 15,
    hints: [
      '光照更直接，颜色、反光、阴影边界都会被放大',
      '午饭、午休、办事间隙交织在一起，停留和穿行会同时存在',
      '找座位、找阴凉、找一口吃的，这些动作会变成很具体的空间线索',
      '商铺、食物、空调外机、树荫会共同影响这片地方的体感',
      '声音不会像早晚那样起伏明显，但会形成一种持续的背景层',
      '适合观察“人在这里怎么躲热、休息、补充体力”',
    ],
  },
  {
    label: '黄昏',
    startHour: 16,
    endHour: 18,
    hints: [
      '自然光和人造光正在交接，亮灯前后的变化会非常明显',
      '放学、下班、买菜、等人、顺路吃点东西这些路径会叠在一起',
      '街道会从“穿行”慢慢转向“停留”，门口和转角更容易聚人',
      '招牌、橱窗、餐馆热气和路边摊位会开始占据注意力',
      '影子拉长，边缘、过渡和颜色变化会比中午更有层次',
      '适合观察“这片地方是怎么从白天过渡到晚上”的',
    ],
  },
  {
    label: '夜间',
    startHour: 19,
    endHour: 23,
    hints: [
      '招牌、窗口、路灯和室内亮面会重新定义这片地方的中心',
      '真正被留下来的人和只是经过的人会更容易区分出来',
      '吃饭、散步、夜跑、等人、抽烟、收摊前后这些动作会变得更可见',
      '声音层次更容易拆开，近处谈话、店内音乐、远处车流会一层层叠起来',
      '白天不显眼的角落，到了夜里可能会因为一束光或一群人突然成立',
      '适合观察“夜里谁还留在这里，以及他们为什么停下”',
    ],
  },
];

function padDatePart(value) {
  return `${value}`.padStart(2, '0');
}

function buildTimeContext(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const hour = date.getHours();
  const config = TIME_PHASE_CONFIGS.find((item) => hour >= item.startHour && hour <= item.endHour) || TIME_PHASE_CONFIGS[0];
    return {
      localTime: `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())} ${padDatePart(hour)}:${padDatePart(date.getMinutes())}`,
      hour,
      timePhase: config.label,
      weekdayType: [0, 6].includes(date.getDay()) ? '周末' : '工作日',
      timeHints: config.hints.slice(0, 6),
    };
  }

function dedupeStrings(values, limit = 6) {
  const result = [];
  (values || []).forEach((item) => {
    const text = String(item || '').trim();
    if (text && !result.includes(text) && result.length < limit) {
      result.push(text);
    }
  });
  return result;
}

const NEARBY_QUERY_OPTIONS = {
  limit: 18,
  radius: 3500,
};

const WALKABLE_AOI_MIN_AREA = 200000;
const WALKABLE_AOI_MAX_AREA = 6000000;
const LOCATION_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const NEARBY_PLACES_CACHE_TTL_MS = 3 * 60 * 1000;

function buildGeoCacheKey(latitude, longitude, suffix = '') {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const latText = Number.isFinite(lat) ? lat.toFixed(5) : 'nan';
  const lngText = Number.isFinite(lng) ? lng.toFixed(5) : 'nan';
  return `${latText},${lngText}${suffix ? `:${suffix}` : ''}`;
}

function readTimedCacheEntry(store, key, ttlMs) {
  if (!(store instanceof Map) || !key || !ttlMs) {
    return null;
  }
  const entry = store.get(key);
  if (!entry || !Number.isFinite(entry.expireAt) || entry.expireAt <= Date.now()) {
    if (entry) {
      store.delete(key);
    }
    return null;
  }
  return entry.value;
}

function writeTimedCacheEntry(store, key, value, ttlMs) {
  if (!(store instanceof Map) || !key) {
    return value;
  }
  store.set(key, {
    value,
    expireAt: Date.now() + ttlMs,
  });
  return value;
}

function buildNearbyTokenText(places) {
  return (places || [])
    .map((item) => [item.name, item.address, item.district, item.typeRaw || item.type, item.typePrimary, item.typeSecondary].filter(Boolean).join(' '))
    .join(' ');
}

function buildNearbyPlaceText(place = {}) {
  return [
    place.name,
    place.address,
    place.district,
    place.typeRaw,
    place.typePrimary,
    place.typeSecondary,
  ].filter(Boolean).join(' ');
}

function getPoiTypeLabel(place = {}) {
  return String(place.typeSecondary || place.typePrimary || place.type || '').trim();
}

function buildNativeCategoryLabel(place = {}) {
  return String(place.typeTertiary || place.typeSecondary || place.typePrimary || place.type || '').trim();
}

const AMAP_TYPECODE_PREFIX_LABELS = {
  '05': '餐饮服务',
  '0503': '快餐厅',
  '0504': '休闲餐饮场所',
  '0505': '咖啡厅',
  '0506': '茶艺馆',
  '0508': '糕饼店',
  '0509': '甜品店',
  '06': '购物服务',
  '0602': '便民商店/便利店',
  '0604': '超级市场',
  '0605': '花鸟鱼虫市场',
  '0607': '综合市场',
  '0610': '特色商业街',
  '07': '生活服务',
  '0705': '物流速递',
  '08': '体育休闲服务',
  '09': '医疗保健服务',
  '10': '住宿服务',
  '11': '风景名胜',
  '1101': '公园广场',
  '1102': '风景名胜',
  '12': '商务住宅',
  '1201': '产业园区',
  '1202': '楼宇',
  '1203': '住宅区',
  '13': '政府机构及社会团体',
  '1301': '政府机关',
  '14': '科教文化服务',
  '1401': '博物馆',
  '1402': '展览馆',
  '1404': '美术馆',
  '1405': '图书馆',
  '1408': '文化宫',
  '1409': '档案馆',
  '1412': '学校',
  '15': '交通设施服务',
  '1502': '火车站',
  '1505': '地铁站',
  '1507': '公交车站',
  '1509': '停车场',
  '16': '金融保险服务',
  '17': '公司企业',
  '18': '道路附属设施',
  '19': '地名地址信息',
  '20': '公共设施',
  '22': '事件活动',
};

function normalizeTypecodePrefix(code, level = 'mid') {
  const normalized = String(code || '').trim();
  if (!/^\d{6}$/.test(normalized)) {
    return '';
  }
  if (level === 'major') {
    return `${normalized.slice(0, 2)}0000`;
  }
  if (level === 'mid') {
    return `${normalized.slice(0, 4)}00`;
  }
  return normalized;
}

function getOfficialTypeLabelFromCode(code) {
  const normalized = String(code || '').trim();
  if (!/^\d{4,6}$/.test(normalized)) {
    return '';
  }
  return AMAP_TYPECODE_PREFIX_LABELS[normalized]
    || AMAP_TYPECODE_PREFIX_LABELS[normalized.slice(0, 4)]
    || AMAP_TYPECODE_PREFIX_LABELS[normalized.slice(0, 2)]
    || '';
}

function getAoiOfficialTypecode(aoi = {}) {
  const value = String(aoi.typecode || aoi.type || '').trim();
  return /^\d{4,6}$/.test(value) ? value : '';
}

function getAoiOfficialTypeLabel(aoi = {}) {
  return getOfficialTypeLabelFromCode(getAoiOfficialTypecode(aoi));
}

function getAoiText(aoi = {}) {
  return [
    aoi.name,
    aoi.type,
    getAoiOfficialTypeLabel(aoi),
    aoi.address,
  ].map((item) => String(item || '').trim()).filter(Boolean).join(' ');
}

function isContainerAoi(aoi = {}) {
  const text = getAoiText(aoi);
  return /校区|校园|学校|大学|学院|公园|景区|景点|风景名胜|广场|商场|购物中心|商业中心|市场|小区|社区|园区|厂区|街区|胡同|古城|博物馆|展览馆|美术馆|图书馆|医院|车站|机场|码头|体育场|湿地|湖区|园/.test(text);
}

function isLeafAoi(aoi = {}) {
  const text = getAoiText(aoi);
  return /食堂|饭堂|餐厅|咖啡|便利店|超市|店|铺|摊|档口|教学楼|宿舍楼|办公楼|楼|门|入口|出口|出入口|厕所|卫生间|停车场|服务中心|柜台|站台/.test(text);
}

function pickPrimaryAoiFromHierarchy(aois) {
  const list = Array.isArray(aois) ? aois.filter(Boolean) : [];
  if (!list.length) {
    return null;
  }
  const container = list.find((item) => isContainerAoi(item) && !isLeafAoi(item));
  if (container) {
    return container;
  }
  if (list.length > 1 && isLeafAoi(list[0])) {
    return list.find((item, index) => index > 0 && !isLeafAoi(item)) || list[1];
  }
  return list[0];
}

function pickLargestWalkableAoi(aois) {
  return (Array.isArray(aois) ? aois : [])
    .filter((item) => {
      const area = Number(item && item.area);
      return Number.isFinite(area)
        && area >= WALKABLE_AOI_MIN_AREA
        && area <= WALKABLE_AOI_MAX_AREA;
    })
    .sort((left, right) => Number(right.area) - Number(left.area))[0] || null;
}

function buildLocationNativeEvidence(contextResponse) {
  const nativeContext = contextResponse && contextResponse.nativeContext && typeof contextResponse.nativeContext === 'object'
    ? contextResponse.nativeContext
    : {};
  const allAois = Array.isArray(nativeContext.aois) ? nativeContext.aois.filter(Boolean) : [];
  const currentAoiHierarchy = allAois
    .filter((item) => {
      const distance = Number(item && item.distance);
      return !Number.isFinite(distance) || distance <= 0;
    })
    .sort((left, right) => {
      const leftArea = Number(left && left.area);
      const rightArea = Number(right && right.area);
      if (Number.isFinite(leftArea) && Number.isFinite(rightArea) && rightArea !== leftArea) {
        return rightArea - leftArea;
      }
      return 0;
    });
  const businessAreas = Array.isArray(nativeContext.businessAreas) ? nativeContext.businessAreas.filter(Boolean).slice(0, 6) : [];
  const effectiveAoiHierarchy = currentAoiHierarchy.length ? currentAoiHierarchy : allAois;
  const aoiHierarchyByAreaAsc = effectiveAoiHierarchy.slice().sort((left, right) => {
    const leftArea = Number(left && left.area);
    const rightArea = Number(right && right.area);
    if (Number.isFinite(leftArea) && Number.isFinite(rightArea) && leftArea !== rightArea) {
      return leftArea - rightArea;
    }
    return 0;
  });
  const primaryAoi = pickLargestWalkableAoi(effectiveAoiHierarchy)
    || pickPrimaryAoiFromHierarchy(aoiHierarchyByAreaAsc)
    || pickPrimaryAoiFromHierarchy(currentAoiHierarchy)
    || allAois[0]
    || null;
  return {
    aois: aoiHierarchyByAreaAsc,
    currentAoiHierarchy: aoiHierarchyByAreaAsc,
    businessAreas,
    primaryAoiName: primaryAoi && primaryAoi.name ? String(primaryAoi.name).trim() : '',
    primaryAoiType: primaryAoi ? getAoiOfficialTypeLabel(primaryAoi) : '',
    primaryAoiTypecode: primaryAoi ? getAoiOfficialTypecode(primaryAoi) : '',
    primaryAoiArea: Number.isFinite(Number(primaryAoi && primaryAoi.area)) ? Number(primaryAoi.area) : null,
    aoiTypes: dedupeStrings(aoiHierarchyByAreaAsc.map((item) => getAoiOfficialTypeLabel(item)), 20),
    aoiTypecodes: dedupeStrings(aoiHierarchyByAreaAsc.map((item) => getAoiOfficialTypecode(item)), 20),
  };
}

function pickSmallestAoiName(contextResponse) {
  const nativeEvidence = buildLocationNativeEvidence(contextResponse);
  return dedupeStrings((nativeEvidence.aois || []).map((item) => item && item.name), 1)[0] || '';
}

function buildNearbyNativeCategories(places, nativeEvidence) {
  const categoryMap = new Map();
  const addCategory = (code, label, score, source) => {
    const normalizedCode = String(code || '').trim();
    const normalizedLabel = String(label || '').trim();
    if (!normalizedCode && !normalizedLabel) {
      return;
    }
    const key = `${normalizedCode || normalizedLabel}::${normalizedLabel || normalizedCode}`;
    const entry = categoryMap.get(key) || {
      id: normalizedCode || normalizedLabel,
      label: normalizedLabel || normalizedCode,
      score: 0,
      sources: [],
    };
    entry.score += score;
    if (source && !entry.sources.includes(source)) {
      entry.sources.push(source);
    }
    categoryMap.set(key, entry);
  };

  (places || []).forEach((place, index) => {
    const code = normalizeTypecodePrefix(place.typecode, 'mid') || normalizeTypecodePrefix(place.typecode, 'major');
    const label = buildNativeCategoryLabel(place);
    if (!code && !label) {
      return;
    }
    const distance = Number(place.distance);
    const proximityWeight = Number.isFinite(distance)
      ? distance <= 300
        ? 1.45
        : distance <= 800
          ? 1.25
          : distance <= 1500
            ? 1.1
            : 0.95
      : index < 6
        ? 1.15
        : 1;
    const rankWeight = index < 4 ? 3 : index < 8 ? 2 : 1.2;
    addCategory(code, label, rankWeight * proximityWeight, 'poi');
  });

  (nativeEvidence.aois || []).forEach((aoi, index) => {
    const officialCode = getAoiOfficialTypecode(aoi);
    const code = normalizeTypecodePrefix(officialCode, 'mid') || normalizeTypecodePrefix(officialCode, 'major');
    const label = getAoiOfficialTypeLabel(aoi) || String(aoi.name || '').trim();
    if (!code && !label) {
      return;
    }
    addCategory(code, label, index === 0 ? 8 : 5, 'aoi');
  });

  return Array.from(categoryMap.values())
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      label: item.label,
      score: Number(item.score.toFixed(2)),
      sources: item.sources,
    }));
}

function inferNativeActivityHints(places, timeContext, nativeEvidence, topCategory) {
  const text = buildNearbyTokenText(places);
  const categoryLabel = String(topCategory && topCategory.label || '').trim();
  const hints = [];
  if ((nativeEvidence.primaryAoiType || '').includes('商圈') || /商圈|购物|商业|餐饮/.test(categoryLabel)) {
    hints.push('停留点多围绕入口、门口和等候处');
  }
  if ((nativeEvidence.primaryAoiType || '').includes('住宅') || /住宅|生活|社区|便民/.test(categoryLabel)) {
    hints.push('顺手办事和短暂停下会比专门停留更多');
  }
  if ((nativeEvidence.primaryAoiType || '').includes('景区') || /风景名胜|景点|博物馆|展馆/.test(categoryLabel)) {
    hints.push('拍照、回望和看说明牌更容易发生');
  }
  if (/交通|车站|地铁|公交|换乘/.test(categoryLabel) || /地铁|公交|车站|换乘|出入口/.test(text)) {
    hints.push('快步流动和短暂停下确认方向会并存');
  }
  if (/餐饮|小吃|咖啡|早餐|夜市/.test(categoryLabel) || /餐饮|小吃|咖啡|面包|夜市|菜市场/.test(text)) {
    hints.push(timeContext.timePhase === '黄昏' ? '顺路买吃的和等位会叠在一起' : '边走边选和短暂停留会同时存在');
  }
  const phaseFallbackMap = {
    凌晨: ['还在运转的人和点位更容易被看见'],
    清晨: ['开门、准备和第一波流动会更明显'],
    上午: ['办事穿行和顺路停一下会并存'],
    午后: ['找阴影、找座位和补给会更具体'],
    黄昏: ['回程、等人和顺路停一下会叠在一起'],
    夜间: ['亮面和人群会重新定义停留中心'],
  };
  (phaseFallbackMap[timeContext.timePhase] || []).forEach((item) => hints.push(item));
  return dedupeStrings(hints, 5);
}

function buildNearbySummary(nearbyPlaces, contextResponse = null, timeContext = buildTimeContext()) {
  const places = Array.isArray(nearbyPlaces) ? nearbyPlaces.filter(Boolean).slice(0, 18) : [];
  const nativeEvidence = buildLocationNativeEvidence(contextResponse);
  const allPlaces = Array.isArray(nearbyPlaces) ? nearbyPlaces.filter(Boolean) : [];
  const representativePlaces = allPlaces;
  const poiNames = dedupeStrings(places.map((item) => item.name), 8);
  const poiTypes = dedupeStrings(places.map((item) => buildNativeCategoryLabel(item)), 8);
  const poiTypecodes = dedupeStrings(places.map((item) => item.typecode), 12);
  return {
    poiNames,
    poiTypes,
    poiTypecodes,
    representativePoiNames: dedupeStrings(representativePlaces.map((item) => item.name), 20),
    representativePoiTypes: dedupeStrings(representativePlaces.map((item) => buildNativeCategoryLabel(item)), 20),
    aoiNames: dedupeStrings((nativeEvidence.aois || []).map((item) => item.name), 20),
    aoiTypes: nativeEvidence.aoiTypes || [],
    aoiTypecodes: nativeEvidence.aoiTypecodes || [],
    primaryAoiName: nativeEvidence.primaryAoiName,
    primaryAoiType: nativeEvidence.primaryAoiType,
    primaryAoiTypecode: nativeEvidence.primaryAoiTypecode,
    primaryAoiArea: nativeEvidence.primaryAoiArea,
    businessAreaNames: dedupeStrings((nativeEvidence.businessAreas || []).map((item) => item.name), 6),
    activityHints: inferNativeActivityHints(places, timeContext, nativeEvidence, null),
    source: 'amap-native',
  };
}

function buildLocationRegion(contextResponse) {
  const nativeContext = contextResponse && contextResponse.nativeContext && typeof contextResponse.nativeContext === 'object'
    ? contextResponse.nativeContext
    : {};
  const addressComponent = nativeContext.addressComponent && typeof nativeContext.addressComponent === 'object'
    ? nativeContext.addressComponent
    : {};
  const province = String(addressComponent.province || '').trim();
  const city = String(addressComponent.city || '').trim();
  const district = String(addressComponent.district || contextResponse && contextResponse.district || '').trim();
  const regionHead = city || province;
  return dedupeStrings([regionHead, district], 2).join('');
}

function buildGenerationContext(pageData) {
  if (!pageData) {
    return {};
  }

  if (pageData.lastGenerationContext) {
    return pageData.lastGenerationContext;
  }

  const timeContext = buildTimeContext();
  const modeScopedFields = resolveModeScopedGenerationFields(pageData, timeContext);
  const nearbySummary = buildNearbySummary(
    pageData.nearbyPlaces,
    pageData.locationContextResponse || null,
    timeContext
  );
  const contextLocationName = pickLocationAnchorName({
    currentName: pageData.locationName,
    contextResponse: pageData.locationContextResponse || null,
    nearbyPlaces: pageData.nearbyPlaces,
  });
  const locationRegion = buildLocationRegion(pageData.locationContextResponse || null);
  const generatedThemeMeta = buildGeneratedThemeMeta(pageData.currentTheme);
  const contextPacket = {
    location: {
      name: contextLocationName,
      region: locationRegion,
      address: pageData.locationAddress || '',
      latitude: Number.isFinite(Number(pageData.latitude)) ? Number(pageData.latitude) : null,
      longitude: Number.isFinite(Number(pageData.longitude)) ? Number(pageData.longitude) : null,
    },
    time: timeContext,
    weather: {
      label: modeScopedFields.weather,
      season: modeScopedFields.season,
    },
    userState: {
      mood: modeScopedFields.mood,
      preference: modeScopedFields.preference,
      selectedThemes: [],
      walkMode: pageData.walkMode || 'pure',
      ...generatedThemeMeta,
    },
    nearby: nearbySummary,
  };
  return {
    weather: modeScopedFields.weather,
    season: modeScopedFields.season,
    mood: modeScopedFields.mood,
    preference: modeScopedFields.preference,
    locationName: contextLocationName,
    locationRegion,
    timeContext,
    nearbySummary,
    ...generatedThemeMeta,
    contextPacket,
  };
}

function formatDebugValue(value) {
  if (Array.isArray(value)) {
    return value.length ? value.join('、') : '未提供';
  }
  const text = String(value || '').trim();
  return text || '未提供';
}

function buildJsonLines(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  try {
    return JSON.stringify(value, null, 2).split('\n');
  } catch (error) {
    return [String(value)];
  }
}

function buildReadableModelRequestLines(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  function formatScalar(input) {
    if (typeof input === 'string') {
      return `"${input.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    if (input === null) {
      return 'null';
    }
    if (input === undefined) {
      return 'undefined';
    }
    return JSON.stringify(input);
  }

  function appendValue(lines, input, indentLevel = 0, keyName = '', trailingComma = false) {
    const indent = '  '.repeat(indentLevel);
    const prefix = keyName ? `${indent}"${keyName}": ` : indent;
    const multilineString = typeof input === 'string' && input.includes('\n');

    if (multilineString) {
      lines.push(`${prefix}"""`);
      input.split('\n').forEach((line) => {
        lines.push(`${indent}  ${line}`);
      });
      lines.push(`${indent}"""${trailingComma ? ',' : ''}`);
      return;
    }

    if (Array.isArray(input)) {
      lines.push(`${prefix}[`);
      input.forEach((item, index) => {
        appendValue(lines, item, indentLevel + 1, '', index < input.length - 1);
      });
      lines.push(`${indent}]${trailingComma ? ',' : ''}`);
      return;
    }

    if (input && typeof input === 'object') {
      const entries = Object.entries(input);
      lines.push(`${prefix}{`);
      entries.forEach(([childKey, childValue], index) => {
        appendValue(lines, childValue, indentLevel + 1, childKey, index < entries.length - 1);
      });
      lines.push(`${indent}}${trailingComma ? ',' : ''}`);
      return;
    }

    lines.push(`${prefix}${formatScalar(input)}${trailingComma ? ',' : ''}`);
  }

  try {
    const lines = [];
    appendValue(lines, value, 0, '', false);
    return lines;
  } catch (error) {
    return buildJsonLines(value);
  }
}

function extractModelCacheStats(modelResponse) {
  const usage = modelResponse && modelResponse.usage && typeof modelResponse.usage === 'object'
    ? modelResponse.usage
    : {};
  const promptTokens = Number.isFinite(Number(usage.prompt_tokens)) ? Number(usage.prompt_tokens) : null;
  const cachedTokensFromDirect = Number.isFinite(Number(usage.cached_tokens)) ? Number(usage.cached_tokens) : null;
  const promptTokenDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
    ? usage.prompt_tokens_details
    : {};
  const cachedTokensFromDetails = Number.isFinite(Number(promptTokenDetails.cached_tokens))
    ? Number(promptTokenDetails.cached_tokens)
    : null;
  const cachedTokens = cachedTokensFromDirect !== null
    ? cachedTokensFromDirect
    : cachedTokensFromDetails;
  const cacheHit = Number.isFinite(cachedTokens) && cachedTokens > 0;
  const cacheRatio = cacheHit && promptTokens
    ? `${Math.round((cachedTokens / promptTokens) * 100)}%`
    : '';
  return {
    cachedTokens,
    promptTokens,
    cacheHit,
    cacheRatio,
  };
}

function buildGenerationDebugState(generationContext, includeHeavy = false) {
  const contextPacket = generationContext && generationContext.contextPacket && typeof generationContext.contextPacket === 'object'
    ? generationContext.contextPacket
    : null;
  const generationSource = generationContext && generationContext.generationSource
    ? String(generationContext.generationSource)
    : '';
  const generationStructureCheck = generationContext && generationContext.generationStructureCheck && typeof generationContext.generationStructureCheck === 'object'
    ? generationContext.generationStructureCheck
    : (contextPacket && contextPacket.structureCheck && typeof contextPacket.structureCheck === 'object'
      ? contextPacket.structureCheck
      : null);
  const generationErrorReason = generationContext && generationContext.generationErrorReason
    ? String(generationContext.generationErrorReason)
    : (contextPacket && contextPacket.generation && contextPacket.generation.errorReason
      ? String(contextPacket.generation.errorReason)
      : '');
  const generationModelRequest = generationContext && generationContext.generationModelRequest && typeof generationContext.generationModelRequest === 'object'
    ? generationContext.generationModelRequest
    : (contextPacket && contextPacket.modelRequest && typeof contextPacket.modelRequest === 'object'
      ? contextPacket.modelRequest
      : null);
  const generationModelResponse = generationContext && generationContext.generationModelResponse && typeof generationContext.generationModelResponse === 'object'
    ? generationContext.generationModelResponse
    : (contextPacket && contextPacket.modelResponse && typeof contextPacket.modelResponse === 'object'
      ? contextPacket.modelResponse
      : null);
  const modelCacheStats = extractModelCacheStats(generationModelResponse);
  const runtimeVersion = generationContext && generationContext.runtimeVersion
    ? String(generationContext.runtimeVersion)
    : (contextPacket && contextPacket.runtimeVersion ? String(contextPacket.runtimeVersion) : '');
  const isDirectMode = /direct/.test(generationSource || '');
  if (!contextPacket) {
    return {
      lastGenerationContext: generationContext || null,
      debugContextAvailable: false,
      debugContextRows: [],
      debugModelRequestLines: [],
      debugModelResponseLines: [],
    };
  }

  if (!includeHeavy) {
    return {
      lastGenerationContext: generationContext,
      debugContextAvailable: true,
      debugContextRows: [],
      debugModelRequestLines: [],
      debugModelResponseLines: [],
    };
  }

  const structureCheckSummary = buildStructureCheckSummary(generationSource, generationStructureCheck);
  const rows = [
    {
      label: '结果来源',
      value: formatDebugValue(generationSource || '未生成'),
    },
    {
      label: '生成失败原因',
      value: formatDebugValue(generationErrorReason || '未提供'),
    },
    {
      label: '运行时版本',
      value: formatDebugValue(runtimeVersion || '未提供'),
    },
    {
      label: '模型名称',
      value: formatDebugValue(
        generationModelRequest
        && generationModelRequest.request
        && generationModelRequest.request.model
      ),
    },
    {
      label: '探索点经纬度',
      value: formatDebugValue(
        contextPacket
        && contextPacket.location
        && Number.isFinite(Number(contextPacket.location.latitude))
        && Number.isFinite(Number(contextPacket.location.longitude))
          ? `${Number(contextPacket.location.latitude).toFixed(6)}, ${Number(contextPacket.location.longitude).toFixed(6)}`
          : '未提供'
      ),
    },
    {
      label: '代表性POI列表',
      value: (
        contextPacket
        && contextPacket.nearby
        && Array.isArray(contextPacket.nearby.representativePoiNames)
          ? (
            contextPacket.nearby.representativePoiNames.length
              ? contextPacket.nearby.representativePoiNames.join('、')
              : '空列表（过滤后无结果）'
          )
          : '未提供'
      ),
    },
    {
      label: '缓存命中',
      value: formatDebugValue(
        modelCacheStats.cachedTokens === null || modelCacheStats.cachedTokens === undefined
          ? '未提供'
          : (modelCacheStats.cacheHit ? '是' : '否')
      ),
    },
    {
      label: '缓存命中 Token',
      value: formatDebugValue(
        modelCacheStats.cachedTokens === null || modelCacheStats.cachedTokens === undefined
          ? '未提供'
          : (modelCacheStats.cacheRatio
            ? `${modelCacheStats.cachedTokens}（约 ${modelCacheStats.cacheRatio}）`
            : modelCacheStats.cachedTokens)
      ),
    },
    {
      label: isDirectMode ? '检查状态' : '验证状态',
      value: formatDebugValue(structureCheckSummary.status),
    },
    {
      label: isDirectMode ? '检查细节' : '验证细节',
      value: formatDebugValue(structureCheckSummary.details),
    },
    {
      label: isDirectMode ? '检查说明' : '复核原因',
      value: formatDebugValue(structureCheckSummary.reasons.length ? structureCheckSummary.reasons : (isDirectMode ? '未提供' : 'AI 未提供')),
    },
  ];

  return {
    lastGenerationContext: generationContext,
    debugContextAvailable: true,
    debugContextRows: rows,
    debugModelRequestLines: includeHeavy && generationModelRequest ? buildReadableModelRequestLines(generationModelRequest) : [],
    debugModelResponseLines: includeHeavy && generationModelResponse ? buildReadableModelRequestLines(generationModelResponse) : [],
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
  return /路|街|巷|道|弄|村|大道/.test(text) && /\d/.test(text);
}

function isGenericLocationName(value) {
  const text = String(value || '').trim();
  return !text
    || text === '当前位置'
    || text === '定位成功'
    || text === '已设为探索点'
    || text === '地图选点'
    || text === '已选地点'
    || text === '城市街道';
}

function isUsableLocationName(value) {
  const text = String(value || '').trim();
  return !!text && !isGenericLocationName(text) && !looksLikeStreetAddress(text);
}

function pickExplicitLocationName(location = {}) {
  return [
    location.placeName,
    location.name,
    location.title,
  ].map((item) => String(item || '').trim()).find(isUsableLocationName) || '';
}

function pickClosestPoiName(places, maxDistance = 80) {
  const candidates = (Array.isArray(places) ? places : [])
    .map((item) => {
      const name = String(item && (item.name || item.title) || '').trim();
      const distance = Number(item && item.distance);
      return {
        name,
        distance: Number.isFinite(distance) ? distance : Number.MAX_SAFE_INTEGER,
      };
    })
    .filter((item) => isUsableLocationName(item.name) && item.distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance);
  return candidates[0] ? candidates[0].name : '';
}

function pickLocationAnchorName({ location, amapSummary, contextResponse, nearbyPlaces, currentName } = {}) {
  const explicitName = pickExplicitLocationName(location) || (isUsableLocationName(currentName) ? String(currentName).trim() : '');
  if (explicitName) {
    return explicitName;
  }
  const closePoiName = pickClosestPoiName(
    []
      .concat(Array.isArray(nearbyPlaces) ? nearbyPlaces : [])
      .concat(amapSummary && Array.isArray(amapSummary.pois) ? amapSummary.pois : []),
    80
  );
  if (closePoiName) {
    return closePoiName;
  }
  return pickSmallestAoiName(contextResponse)
    || (amapSummary && isUsableLocationName(amapSummary.placeName) ? String(amapSummary.placeName).trim() : '')
    || (isUsableLocationName(currentName) ? String(currentName).trim() : '')
    || '当前位置';
}

function pickBestLocationName({ location, amapSummary, contextResponse, nearbyPlaces }) {
  return pickLocationAnchorName({
    location,
    amapSummary,
    contextResponse,
    nearbyPlaces,
  });
}

function buildNearbyPlaceViews(results) {
  return (results || []).map((item, index) => {
    const typeRaw = item.type ? String(item.type).trim() : '';
    const typeParts = typeRaw.split(';').map((part) => part.trim()).filter(Boolean);
    const typePrimary = typeParts[0] || '';
    const typeSecondary = typeParts[1] || '';
    const typeTertiary = typeParts[2] || '';
    return {
      id: item.id || item.link || `${item.title || 'poi'}-${index}`,
      name: item.title || item.name || '附近地点',
      address: item.address || item.district || '',
      district: item.district || item.city || '',
      type: typeSecondary || typePrimary,
      typeRaw,
      typePrimary,
      typeSecondary,
      typeTertiary,
      typecode: item.typecode ? String(item.typecode).trim() : '',
      distance: Number.isFinite(Number(item.distance)) ? Number(item.distance) : null,
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
    };
  })
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
    .sort((left, right) => {
      const leftDistance = Number.isFinite(Number(left.distance)) ? Number(left.distance) : Number.MAX_SAFE_INTEGER;
      const rightDistance = Number.isFinite(Number(right.distance)) ? Number(right.distance) : Number.MAX_SAFE_INTEGER;
      if (leftDistance !== rightDistance) {
        return leftDistance - rightDistance;
      }
      return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN');
    })
    .slice(0, NEARBY_QUERY_OPTIONS.limit);
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

  if (/INVALID_USER_KEY|USERKEY_PLAT_NOMATCH|SERVICE_NOT_AVAILABLE|DAILY_QUERY_OVER_LIMIT|ACCESS_TOO_FREQUENT|INVALID_IP/i.test(message)) {
    return {
      title: '高德 Key 权限异常',
      content: `高德逆地理请求失败：${message}。请检查当前 Key 权限、配额和平台配置。`,
    };
  }

  if (/timeout|超时/i.test(message)) {
    return {
      title: '周边地点请求超时',
      content: `请求高德逆地理 POI 超时：${message}。请检查网络状态后重试。`,
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
    generationBusy: false,
    generationViewState: null,
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
    locationContext: '',
    locationContextResponse: null,
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
    lastGenerationContext: null,
    debugContextAvailable: false,
    debugContextRows: [],
    showGenerationDebug: false,
    supportsNearbyPois: false,
    privacyPopup: createDefaultPrivacyPopup(),
  },

  onLoad() {
      this.locationResolveToken = 0;
      this.generationStageTimer = null;
      this.generationRequestCache = {
        locationContext: new Map(),
        nearbyPlaces: new Map(),
        pendingLocationContext: new Map(),
        pendingNearbyPlaces: new Map(),
      };
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
      this.prefetchGenerationPrerequisites({
        latitude: 39.908823,
        longitude: 116.39747,
        placeName: '天安门-城楼',
      });
      app.globalData.currentTheme = currentTheme;
      this.syncDisplayMeta(currentTheme, 'preset', 'pure');
    },

  onUnload() {
    this.clearGenerationStageTimer();
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
      'ai-direct': 'AI 直出',
      'ai-direct-raw': '模型原样',
      'ai-direct-error': '模型失败',
      'ai-direct-fallback': '直出兜底',
      'ai-direct-partial-fallback': '模型补齐',
      'random-direct': '随机直出',
      'random-direct-fallback': '随机兜底',
      'random-direct-partial-fallback': '随机补齐',
      'combined-direct': '组合直出',
      'combined-direct-raw': '组合模型原样',
      'combined-direct-error': '组合模型失败',
      'combined-direct-fallback': '组合兜底',
      'combined-direct-partial-fallback': '组合补齐',
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
      locationContext: '',
      locationContextResponse: null,
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
      lastGenerationContext: null,
    });
    return true;
  },

  markExplorePointConfirmed() {
    if (!this.data.hasConfirmedExplorePoint) {
      this.setData({ hasConfirmedExplorePoint: true });
    }
  },

  ensureExplorePointReadyForGeneration() {
    if (this.data.hasConfirmedExplorePoint) {
      return true;
    }
    wx.showToast({
      title: '请先定位、搜索或设为探索点，再生成漫步主题',
      icon: 'none',
      duration: 2600,
    });
    return false;
  },

  clearGenerationStageTimer() {
    if (this.generationStageTimer) {
      clearTimeout(this.generationStageTimer);
      this.generationStageTimer = null;
    }
  },

  scheduleGenerationStageOvertime() {
    this.clearGenerationStageTimer();
    if (!this.generationStageState || this.generationStageState.status !== 'loading') {
      return;
    }
    const stageKey = this.generationStageState.stage;
    const meta = GENERATION_STAGE_META[stageKey] || GENERATION_STAGE_META.confirm;
    const timeoutMs = Number(meta.durationMs) || 1000;
    this.generationStageTimer = setTimeout(() => {
      if (!this.generationStageState || this.generationStageState.status !== 'loading') {
        return;
      }
      if (this.generationStageState.stage !== stageKey) {
        return;
      }
      this.generationStageState = {
        ...this.generationStageState,
        overtime: true,
      };
      this.setData({
        generationViewState: buildGenerationViewState(this.generationStageState),
      });
    }, timeoutMs);
  },

  beginGenerationStageFlow(missionCount) {
    this.generationStageState = {
      status: 'loading',
      stage: 'confirm',
      overtime: false,
      missionCount: Math.max(1, Number(missionCount) || 1),
    };
    this.setData({
      generationBusy: true,
      generationViewState: buildGenerationViewState(this.generationStageState),
    });
    this.scheduleGenerationStageOvertime();
  },

  advanceGenerationStage(stage, patch = {}) {
    if (!this.generationStageState || this.generationStageState.status !== 'loading') {
      return;
    }
    if (!GENERATION_STAGE_META[stage]) {
      return;
    }
    this.generationStageState = {
      ...this.generationStageState,
      stage,
      overtime: false,
      ...patch,
    };
    this.setData({
      generationViewState: buildGenerationViewState(this.generationStageState),
    });
    this.scheduleGenerationStageOvertime();
  },

  finishGenerationStageFlow() {
    this.clearGenerationStageTimer();
    this.generationStageState = null;
    return {
      generationBusy: false,
      generationViewState: null,
    };
  },

  failGenerationStageFlow() {
    this.clearGenerationStageTimer();
    const missionCount = this.generationStageState && this.generationStageState.missionCount
      ? this.generationStageState.missionCount
      : (this.data.walkMode === 'advanced' ? 3 : 1);
    const stage = this.generationStageState && this.generationStageState.stage
      ? this.generationStageState.stage
      : 'generate';
    this.generationStageState = {
      status: 'error',
      stage,
      missionCount,
      message: '可以直接再次点击生成，我们会重新组织这次漫步线索。',
    };
    return {
      generationBusy: false,
      generationViewState: buildGenerationViewState(this.generationStageState),
    };
  },

  setOption(event) {
    const { field, value } = event.currentTarget.dataset;
    const nextState = { [field]: value };
    if (field === 'walkMode') {
      const combineSelections = normalizeCombineSelections(this.data.combineSelections, value);
      nextState.combineSelections = combineSelections;
      nextState.combineOptionViews = buildCombineOptionViews(combineSelections);
    }
    if (field === 'walkMode' && this.data.currentTheme) {
      const nextTheme = trimTheme(this.data.currentTheme, value);
      nextState.currentTheme = nextTheme;
      this.setData(nextState);
      app.globalData.currentTheme = nextTheme;
      this.syncDisplayMeta(nextTheme, this.data.currentThemeSource, value);
      return;
    }
    this.setData(nextState);
  },

  toggleGenerationDebug() {
      const nextShow = !this.data.showGenerationDebug;
      this.setData({
        showGenerationDebug: nextShow,
        ...buildGenerationDebugState(this.data.lastGenerationContext, nextShow),
      });
    },

  toggleCombineSelection(event) {
      const value = event.currentTarget.dataset.value;
      const current = normalizeCombineSelections(this.data.combineSelections, this.data.walkMode);
    const isPureMode = this.data.walkMode === 'pure';
    let combineSelections = current;
    if (current.includes(value)) {
      combineSelections = current.filter((item) => item !== value);
    } else if (isPureMode) {
      combineSelections = [value];
    } else {
      combineSelections = current.concat(value).slice(0, 2);
      }
      this.setData({ combineSelections, combineOptionViews: buildCombineOptionViews(combineSelections) });
    },

    getGenerationRequestCache() {
      if (!this.generationRequestCache) {
        this.generationRequestCache = {
          locationContext: new Map(),
          nearbyPlaces: new Map(),
          pendingLocationContext: new Map(),
          pendingNearbyPlaces: new Map(),
        };
      }
      return this.generationRequestCache;
    },

    async fetchLocationContextWithCache({ latitude, longitude, placeName = '', force = false } = {}) {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }
      const cache = this.getGenerationRequestCache();
      const key = buildGeoCacheKey(lat, lng, String(placeName || '').trim());
      if (!force) {
        const cached = readTimedCacheEntry(cache.locationContext, key, LOCATION_CONTEXT_CACHE_TTL_MS);
        if (cached) {
          return cached;
        }
        if (cache.pendingLocationContext.has(key)) {
          return cache.pendingLocationContext.get(key);
        }
      }
      const request = getLocationContext({
        latitude: lat,
        longitude: lng,
        placeName,
      }).then((result) => {
        cache.pendingLocationContext.delete(key);
        if (result) {
          writeTimedCacheEntry(cache.locationContext, key, result, LOCATION_CONTEXT_CACHE_TTL_MS);
        }
        return result || null;
      }).catch((error) => {
        cache.pendingLocationContext.delete(key);
        throw error;
      });
      cache.pendingLocationContext.set(key, request);
      return request;
    },

    async fetchNearbyPlacesWithCache(latitude, longitude, { force = false } = {}) {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return [];
      }
      const cache = this.getGenerationRequestCache();
      const key = buildGeoCacheKey(lat, lng, JSON.stringify(NEARBY_QUERY_OPTIONS));
      if (!force) {
        const cached = readTimedCacheEntry(cache.nearbyPlaces, key, NEARBY_PLACES_CACHE_TTL_MS);
        if (cached) {
          return cached;
        }
        if (cache.pendingNearbyPlaces.has(key)) {
          return cache.pendingNearbyPlaces.get(key);
        }
      }
      const request = getRegeo({ latitude: lat, longitude: lng })
        .then((regeo) => {
          cache.pendingNearbyPlaces.delete(key);
          const amapSummary = normalizeAmapLocation(regeo, '');
          const nearbyPlaces = buildNearbyPlaceViews(amapSummary.pois || []);
          writeTimedCacheEntry(cache.nearbyPlaces, key, nearbyPlaces, NEARBY_PLACES_CACHE_TTL_MS);
          return nearbyPlaces;
        })
        .catch((error) => {
          cache.pendingNearbyPlaces.delete(key);
          throw error;
        });
      cache.pendingNearbyPlaces.set(key, request);
      return request;
    },

    async prefetchGenerationPrerequisites({ latitude, longitude, placeName = '' } = {}) {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { locationContextResult: null, nearbyPlaces: [] };
      }
      const [locationContextResult, nearbyPlaces] = await Promise.all([
        this.fetchLocationContextWithCache({ latitude: lat, longitude: lng, placeName }).catch(() => null),
        this.fetchNearbyPlacesWithCache(lat, lng).catch(() => []),
      ]);
      return {
        locationContextResult,
        nearbyPlaces,
      };
    },

    async enrichLocation(location) {
      const token = ++this.locationResolveToken;
      const regeo = await getRegeo(location).catch(() => null);
      const amapSummary = normalizeAmapLocation(regeo, location.placeName || location.name || location.address);
      const regeoNearbyPlaces = buildNearbyPlaceViews(amapSummary.pois || []);
      const initialLocationName = pickBestLocationName({
        location,
        amapSummary,
        contextResponse: null,
        nearbyPlaces: regeoNearbyPlaces,
      });
      const { locationContextResult, nearbyPlaces: fetchedNearbyPlaces } = await this.prefetchGenerationPrerequisites({
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
        placeName: initialLocationName,
      });
      const nearbyPlaces = regeoNearbyPlaces.length ? regeoNearbyPlaces : fetchedNearbyPlaces;
      const displayLocationName = pickBestLocationName({
        location,
        amapSummary,
        contextResponse: locationContextResult,
        nearbyPlaces,
      });
      if (token !== this.locationResolveToken) {
        return;
      }
    this.setData({
      latitude: location.latitude,
      longitude: location.longitude,
      locationName: displayLocationName,
      locationContext: locationContextResult && locationContextResult.context
        ? String(locationContextResult.context).trim()
        : (displayLocationName && displayLocationName !== '当前位置' ? displayLocationName : ''),
      locationContextResponse: locationContextResult || null,
      locationAddress: amapSummary.address || location.address || '',
      searchResults: [],
      searchResultCount: 0,
        ...this.buildMapState({
          latitude: location.latitude,
          longitude: location.longitude,
          placeName: displayLocationName || location.name || '已选地点',
        }),
        nearbyPlaces: nearbyPlaces || [],
        nearbyExpanded: !!(nearbyPlaces && nearbyPlaces.length),
        lastGenerationContext: null,
      });
    },

    async loadNearbyPlaces(latitude, longitude) {
    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
      this.setData({ nearbyPlaces: [], nearbyExpanded: false, loadingNearbyPlaces: false });
      return;
    }

      this.setData({ loadingNearbyPlaces: true });
      try {
        const regeo = await getRegeo({ latitude, longitude }).catch(() => null);
        const amapSummary = normalizeAmapLocation(regeo, this.data.locationName || this.data.locationAddress);
        const regeoNearbyPlaces = buildNearbyPlaceViews(amapSummary.pois || []);
        const nearbyPlaces = regeoNearbyPlaces.length
          ? regeoNearbyPlaces
          : await this.fetchNearbyPlacesWithCache(Number(latitude), Number(longitude), { force: true });
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

    async ensureGenerationLocationContext() {
    if (this.data.locationContextResponse && this.data.locationContextResponse.context) {
      return this.data.locationContextResponse;
    }

    if (this.data.locationContext) {
      return {
        context: this.data.locationContext,
        nativeContext: this.data.locationContextResponse && this.data.locationContextResponse.nativeContext
          ? this.data.locationContextResponse.nativeContext
          : null,
      };
    }

    const latitude = Number(this.data.latitude);
    const longitude = Number(this.data.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return '';
      }

      try {
        const result = await this.fetchLocationContextWithCache({
          latitude,
          longitude,
          placeName: this.data.locationName,
        });
      const locationContext = result && result.context ? String(result.context).trim() : '';
      if (locationContext || result) {
        this.setData({
          locationContext: locationContext || this.data.locationContext || '',
          locationContextResponse: result || null,
        });
      }
      return result || {
        context: locationContext,
        nativeContext: null,
      };
    } catch (error) {
      return {
        context: this.data.locationContext || '',
        nativeContext: this.data.locationContextResponse && this.data.locationContextResponse.nativeContext
          ? this.data.locationContextResponse.nativeContext
          : null,
      };
    }
  },

    async ensureGenerationNearbyPlaces() {
    if (Array.isArray(this.data.nearbyPlaces) && this.data.nearbyPlaces.length) {
      return this.data.nearbyPlaces;
    }

    const latitude = Number(this.data.latitude);
    const longitude = Number(this.data.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return [];
      }

      try {
        const nearbyPlaces = await this.fetchNearbyPlacesWithCache(latitude, longitude);
        this.setData({
          nearbyPlaces,
          nearbyExpanded: nearbyPlaces.length ? this.data.nearbyExpanded : false,
        });
      return nearbyPlaces;
    } catch (error) {
      return [];
    }
  },

  async buildGenerationPayload(basePayload = {}) {
    const timeContext = buildTimeContext();
    const modeScopedFields = resolveModeScopedGenerationFields({
      ...this.data,
      ...basePayload,
    }, timeContext);
    const [locationContextResult, nearbyPlaces] = await Promise.all([
      this.ensureGenerationLocationContext(),
      this.ensureGenerationNearbyPlaces(),
    ]);
    const nearbySummary = buildNearbySummary(
      nearbyPlaces && nearbyPlaces.length ? nearbyPlaces : this.data.nearbyPlaces,
      locationContextResult || this.data.locationContextResponse || null,
      timeContext
    );
    const contextLocationName = pickLocationAnchorName({
      currentName: this.data.locationName,
      contextResponse: locationContextResult || this.data.locationContextResponse || null,
      nearbyPlaces: nearbyPlaces && nearbyPlaces.length ? nearbyPlaces : this.data.nearbyPlaces,
    });
    const locationRegion = buildLocationRegion(locationContextResult || this.data.locationContextResponse || null);
    const normalizedSelectedThemes = normalizeGenerationThemeList(
      Array.isArray(basePayload.selectedThemes)
        ? basePayload.selectedThemes
        : Array.isArray(basePayload.categories)
          ? basePayload.categories
          : []
    );
    const existingRecentHistory = normalizeRecentMissionHistoryEntries(
      this.data.lastGenerationContext
      && this.data.lastGenerationContext.contextPacket
      && this.data.lastGenerationContext.contextPacket.generation
        ? this.data.lastGenerationContext.contextPacket.generation.recentMissionHistory
        : []
    );
    const fallbackRecentHistory = !existingRecentHistory.length
      ? appendThemeToRecentMissionHistory([], this.data.currentTheme || null, this.data.generationSource || '')
      : existingRecentHistory;
    const contextPacket = {
      location: {
        name: contextLocationName,
        region: locationRegion,
        address: this.data.locationAddress || '',
        latitude: Number.isFinite(Number(this.data.latitude)) ? Number(this.data.latitude) : null,
        longitude: Number.isFinite(Number(this.data.longitude)) ? Number(this.data.longitude) : null,
      },
      time: timeContext,
      weather: {
        label: modeScopedFields.weather,
        season: modeScopedFields.season,
      },
      userState: {
        mood: modeScopedFields.mood,
        preference: modeScopedFields.preference,
        selectedThemes: normalizedSelectedThemes,
        walkMode: this.data.walkMode || 'pure',
        generatedThemeCategory: '',
        generatedThemeTitle: '',
      },
      nearby: nearbySummary,
      generation: {
        seed: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        previousThemeTitle: this.data.currentTheme && this.data.currentTheme.title
          ? String(this.data.currentTheme.title).trim()
          : '',
        previousMissions: Array.isArray(this.data.currentTheme && this.data.currentTheme.missions)
          ? this.data.currentTheme.missions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
          : [],
        recentMissionHistory: fallbackRecentHistory,
      },
    };
    const generationContext = {
      mood: modeScopedFields.mood,
      weather: modeScopedFields.weather,
      season: modeScopedFields.season,
      preference: modeScopedFields.preference,
      locationName: contextLocationName,
      locationRegion,
      timeContext,
      nearbySummary,
      generationSeed: contextPacket.generation.seed,
      contextPacket,
    };
    return {
      ...basePayload,
      ...generationContext,
      locationName: contextLocationName,
      locationRegion,
      generationContext,
    };
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
    if (!this.ensureExplorePointReadyForGeneration()) {
      return;
    }
    this.beginGenerationStageFlow(this.data.walkMode === 'advanced' ? 3 : 1);
    this.setData({ isGenerating: true });
    try {
      this.advanceGenerationStage('gather');
      const normalizedSelections = normalizeCombineSelections(this.data.combineSelections, this.data.walkMode);
      const selectedThemes = buildSelectedThemeCategories(normalizedSelections);
      const effectiveThemes = selectedThemes.length
        ? selectedThemes
        : buildSelectedThemeCategories([pickRandomThemeCategory(this.data.randomCategories)]);
      const useCombinedTheme = this.data.walkMode === 'advanced' && normalizedSelections.length > 1;
      const payload = await this.buildGenerationPayload({
        mood: this.data.mood,
        weather: this.data.weather,
        season: this.data.season,
        preference: this.data.preference,
        locationName: this.data.locationName,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        walkMode: this.data.walkMode,
        selectedThemes: useCombinedTheme ? normalizedSelections : effectiveThemes,
      });
      this.setData(buildGenerationDebugState(payload.generationContext, this.data.showGenerationDebug));
      this.advanceGenerationStage('generate');
      const result = useCombinedTheme
        ? await generateCombinedTheme({
          ...payload,
          categories: normalizedSelections,
        })
        : await generateTheme(payload);
      this.advanceGenerationStage('finalize');
      const currentTheme = trimTheme({ ...result.theme, allMissions: result.theme.missions, locationName: this.data.locationName }, this.data.walkMode);
      const nextGenerationContext = applyGeneratedThemeMetaToContext(
        payload.generationContext,
        currentTheme,
        result.source || (useCombinedTheme ? 'combined-direct-fallback' : 'ai-direct-fallback'),
        result.structureCheck || null,
        result.runtimeVersion || '',
        result.reason || '',
        result.modelRequest || null,
        result.modelResponse || null
      );
      this.setData({
        currentTheme,
        ...buildGenerationDebugState(nextGenerationContext, this.data.showGenerationDebug),
        ...this.finishGenerationStageFlow(),
      });
      app.globalData.currentTheme = currentTheme;
      this.syncDisplayMeta(currentTheme, result.source || (useCombinedTheme ? 'combined-direct-fallback' : 'ai-direct-fallback'));
    } catch (error) {
      this.setData(this.failGenerationStageFlow());
      wx.showToast({
        title: GENERATION_ERROR_COPY,
        icon: 'none',
        duration: 2200,
      });
    } finally {
      this.setData({ isGenerating: false });
    }
  },

  async handleRandomTheme() {
    if (!this.ensureExplorePointReadyForGeneration()) {
      return;
    }
    this.beginGenerationStageFlow(this.data.walkMode === 'advanced' ? 3 : 1);
    this.setData({ isGenerating: true });
    try {
      this.advanceGenerationStage('gather');
      const categoryPool = this.data.randomCategories;
      const category = categoryPool[Math.floor(Math.random() * categoryPool.length)];
      const selectedThemes = buildSelectedThemeCategories([category]);
      const payload = await this.buildGenerationPayload({
        mood: this.data.mood,
        weather: this.data.weather,
        season: this.data.season,
        preference: this.data.preference,
        locationName: this.data.locationName,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        walkMode: this.data.walkMode,
        selectedThemes,
      });
      this.setData(buildGenerationDebugState(payload.generationContext, this.data.showGenerationDebug));
      this.advanceGenerationStage('generate');
      const result = await generateTheme({
        ...payload,
        selectedThemes,
      });
      const displaySource = normalizeRandomSource(result.source);
      this.advanceGenerationStage('finalize');
      const currentTheme = trimTheme({ ...result.theme, allMissions: result.theme.missions, locationName: this.data.locationName }, this.data.walkMode);
      const nextGenerationContext = applyGeneratedThemeMetaToContext(
        payload.generationContext,
        currentTheme,
        displaySource,
        result.structureCheck || null,
        result.runtimeVersion || '',
        result.reason || '',
        result.modelRequest || null,
        result.modelResponse || null
      );
      this.setData({
        currentTheme,
        ...buildGenerationDebugState(nextGenerationContext, this.data.showGenerationDebug),
        ...this.finishGenerationStageFlow(),
      });
      app.globalData.currentTheme = currentTheme;
      this.syncDisplayMeta(currentTheme, displaySource);
    } catch (error) {
      this.setData(this.failGenerationStageFlow());
      wx.showToast({
        title: GENERATION_ERROR_COPY,
        icon: 'none',
        duration: 2200,
      });
    } finally {
      this.setData({ isGenerating: false });
    }
  },

  async handleSelectedThemeGenerate() {
    if (!this.ensureExplorePointReadyForGeneration()) {
      return;
    }
    const normalizedSelections = normalizeCombineSelections(this.data.combineSelections, this.data.walkMode);
    if (normalizedSelections.length !== this.data.combineSelections.length) {
      this.setData({
        combineSelections: normalizedSelections,
        combineOptionViews: buildCombineOptionViews(normalizedSelections),
      });
    }
    if (!normalizedSelections.length) {
      wx.showToast({
        title: '请先选择主题',
        icon: 'none',
        duration: 1800,
      });
      return;
    }
    this.beginGenerationStageFlow(this.data.walkMode === 'advanced' ? 3 : 1);
    this.setData({ isCombining: true });
    try {
      this.advanceGenerationStage('gather');
      const selections = normalizedSelections;
      const useCombinedTheme = this.data.walkMode !== 'pure' && selections.length > 1;
      const payload = await this.buildGenerationPayload({
        mood: this.data.mood,
        weather: this.data.weather,
        season: this.data.season,
        preference: this.data.preference,
        locationName: this.data.locationName,
        latitude: this.data.latitude,
        longitude: this.data.longitude,
        walkMode: this.data.walkMode,
        selectedThemes: useCombinedTheme ? selections : buildSelectedThemeCategories(selections),
      });
      this.setData(buildGenerationDebugState(payload.generationContext, this.data.showGenerationDebug));
      this.advanceGenerationStage('generate');
      const result = !useCombinedTheme
        ? await generateTheme({
          ...payload,
          selectedThemes: buildSelectedThemeCategories(selections),
        })
        : await generateCombinedTheme({
          ...payload,
          categories: selections,
        });
      this.advanceGenerationStage('finalize');
      const currentTheme = trimTheme({ ...result.theme, allMissions: result.theme.missions, locationName: this.data.locationName }, this.data.walkMode);
      const nextGenerationContext = applyGeneratedThemeMetaToContext(
        payload.generationContext,
        currentTheme,
        result.source || (useCombinedTheme ? 'combined-direct-fallback' : 'ai-direct-fallback'),
        result.structureCheck || null,
        result.runtimeVersion || '',
        result.reason || '',
        result.modelRequest || null,
        result.modelResponse || null
      );
      this.setData({
        currentTheme,
        ...buildGenerationDebugState(nextGenerationContext, this.data.showGenerationDebug),
        ...this.finishGenerationStageFlow(),
      });
      app.globalData.currentTheme = currentTheme;
      this.syncDisplayMeta(
        currentTheme,
        result.source || (useCombinedTheme ? 'combined-direct-fallback' : 'ai-direct-fallback')
      );
    } catch (error) {
      this.setData(this.failGenerationStageFlow());
      wx.showToast({
        title: GENERATION_ERROR_COPY,
        icon: 'none',
        duration: 2200,
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
        locationContext: this.data.locationContext || '',
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
        locationContext: this.data.locationContext || '',
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
        locationContext: this.data.locationContext || '',
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

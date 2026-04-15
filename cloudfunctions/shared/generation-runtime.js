function getGenerationContext(event) {
  return event && event.generationContext && typeof event.generationContext === 'object'
    ? event.generationContext
    : {};
}

function getRuntimeMemo(event) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  if (!event.__runtimeMemo || typeof event.__runtimeMemo !== 'object') {
    Object.defineProperty(event, '__runtimeMemo', {
      value: {},
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }
  return event.__runtimeMemo;
}

function getContextPacket(event) {
  const generationContext = getGenerationContext(event);
  return generationContext.contextPacket && typeof generationContext.contextPacket === 'object'
    ? generationContext.contextPacket
    : {};
}

function normalizeLocationSignals(event) {
  const memo = getRuntimeMemo(event);
  if (memo && memo.locationSignals) {
    return memo.locationSignals;
  }
  const contextPacket = getContextPacket(event);
  const locationPacket = contextPacket.location && typeof contextPacket.location === 'object'
    ? contextPacket.location
    : {};
  const result = {
      locationName: event.locationName || locationPacket.name || '',
      locationContext: event.locationContext || event.sceneTag || event.placeName || locationPacket.sceneTag || '',
      sceneTag: event.sceneTag || event.locationContext || locationPacket.sceneTag || '',
    };
  if (memo) {
    memo.locationSignals = result;
  }
  return result;
}

function normalizeTimeContext(event) {
  const memo = getRuntimeMemo(event);
  if (memo && memo.timeContext) {
    return memo.timeContext;
  }
  const contextPacket = getContextPacket(event);
  const packetTime = contextPacket.time && typeof contextPacket.time === 'object' ? contextPacket.time : {};
  const generationContext = getGenerationContext(event);
  const timeContext = event && event.timeContext && typeof event.timeContext === 'object'
    ? event.timeContext
    : generationContext.timeContext && typeof generationContext.timeContext === 'object'
      ? generationContext.timeContext
      : packetTime;
  const result = {
      localTime: typeof timeContext.localTime === 'string' ? timeContext.localTime : '',
    hour: Number.isFinite(Number(timeContext.hour)) ? Number(timeContext.hour) : null,
    timePhase: typeof timeContext.timePhase === 'string' ? timeContext.timePhase : '',
    weekdayType: typeof timeContext.weekdayType === 'string' ? timeContext.weekdayType : '',
      timeHints: Array.isArray(timeContext.timeHints)
        ? timeContext.timeHints.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
        : [],
    };
  if (memo) {
    memo.timeContext = result;
  }
  return result;
}

function summarizeCoreTimeHints(timeContext) {
  const context = timeContext && typeof timeContext === 'object' ? timeContext : {};
  const phase = String(context.timePhase || '').trim();
  const rawHints = Array.isArray(context.timeHints)
    ? context.timeHints.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const phaseSummaryMap = {
    清晨: '刚开始热起来，第一波动静和开场迹象最明显。',
    上午: '环境已经启动，但还没到最拥挤的时候，细节比较清楚。',
    午后: '光线和热度更强，停留、避让和绕行更容易被看见。',
    黄昏: '亮度在变，收摊、亮灯和人流转换最容易出现。',
    夜间: '光源集中、背景变暗，近处线索和停留点更突出。',
    凌晨: '人少而空，仍在运转的声音、灯光和值守痕迹最关键。',
  };
  const keywordRules = [
    { pattern: /安全|值守|保安|夜班|看守/, text: '优先看明亮、有人值守或仍在运转的位置。' },
    { pattern: /人少|空旷|拉开|稀疏/, text: '人流变少，近处的小动静和局部细节更容易单独冒出来。' },
    { pattern: /亮|灯|窗口|招牌|照明/, text: '灯光、窗口和招牌会把可观察的对象主动托出来。' },
    { pattern: /声音|回声|脚步|风声|摩擦/, text: '声音层次更容易分开，近处和远处的差别更清楚。' },
    { pattern: /风|凉|降温/, text: '风感和空气变化会让边缘、声响和气味更容易被察觉。' },
    { pattern: /清扫|补货|收摊|开门|出摊/, text: '正在收尾或继续运转的小动作，比白天更容易成为线索。' },
  ];
  const summaries = [];
  const phaseSummary = phaseSummaryMap[phase] || '';
  if (phaseSummary) {
    summaries.push(phaseSummary);
  }
  keywordRules.forEach((rule) => {
    if (summaries.length >= 3) {
      return;
    }
    if (rawHints.some((item) => rule.pattern.test(item)) && !summaries.includes(rule.text)) {
      summaries.push(rule.text);
    }
  });
  if (!summaries.length && rawHints.length) {
    summaries.push(rawHints[0]);
  }
  return summaries.slice(0, 3);
}

function normalizePreference(event) {
  const contextPacket = getContextPacket(event);
  const userState = contextPacket.userState && typeof contextPacket.userState === 'object'
    ? contextPacket.userState
    : {};
  return String(event.preference || userState.preference || '').trim();
}

function looksLikeAmapTypecode(value) {
  return /^\d{4,6}$/.test(String(value || '').trim());
}

function normalizeAoiTypecodeList(values, limit = 8) {
  const result = [];
  (Array.isArray(values) ? values : [values]).forEach((item) => {
    const text = String(item || '').trim();
    if (looksLikeAmapTypecode(text) && !result.includes(text) && result.length < limit) {
      result.push(text);
    }
  });
  return result;
}

function normalizeNearbySummary(event) {
  const memo = getRuntimeMemo(event);
  if (memo && memo.nearbySummary) {
    return memo.nearbySummary;
  }
  const contextPacket = getContextPacket(event);
  const packetNearby = contextPacket.nearby && typeof contextPacket.nearby === 'object' ? contextPacket.nearby : {};
  const generationContext = getGenerationContext(event);
  const nearbySummary = event && event.nearbySummary && typeof event.nearbySummary === 'object'
    ? event.nearbySummary
    : generationContext.nearbySummary && typeof generationContext.nearbySummary === 'object'
      ? generationContext.nearbySummary
      : packetNearby;
  const rawPrimaryAoiType = typeof nearbySummary.primaryAoiType === 'string' ? nearbySummary.primaryAoiType : '';
  const rawPrimaryAoiTypecode = typeof nearbySummary.primaryAoiTypecode === 'string' ? nearbySummary.primaryAoiTypecode : '';
  const normalizedPrimaryAoiTypecode = looksLikeAmapTypecode(rawPrimaryAoiTypecode)
    ? rawPrimaryAoiTypecode
    : looksLikeAmapTypecode(rawPrimaryAoiType)
      ? rawPrimaryAoiType
      : '';
  const normalizedPrimaryAoiType = looksLikeAmapTypecode(rawPrimaryAoiType) ? '' : rawPrimaryAoiType;
  const result = {
    poiNames: Array.isArray(nearbySummary.poiNames)
      ? nearbySummary.poiNames.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
      : [],
    poiTypes: Array.isArray(nearbySummary.poiTypes)
      ? nearbySummary.poiTypes.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : [],
    poiTypecodes: Array.isArray(nearbySummary.poiTypecodes)
      ? nearbySummary.poiTypecodes.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
      : [],
    dominantSceneId: typeof nearbySummary.dominantSceneId === 'string' ? nearbySummary.dominantSceneId : '',
    dominantScene: typeof nearbySummary.dominantScene === 'string' ? nearbySummary.dominantScene : '',
    sceneCandidates: Array.isArray(nearbySummary.sceneCandidates)
      ? nearbySummary.sceneCandidates
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return null;
          }
          return {
            id: typeof item.id === 'string' ? item.id : '',
            label: typeof item.label === 'string' ? item.label : '',
            score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
          };
        })
        .filter(Boolean)
        .slice(0, 3)
      : [],
    aoiNames: Array.isArray(nearbySummary.aoiNames)
      ? nearbySummary.aoiNames.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : [],
    aoiTypecodes: normalizeAoiTypecodeList(
      []
        .concat(nearbySummary.aoiTypecodes || [])
        .concat(normalizedPrimaryAoiTypecode || [])
        .concat(rawPrimaryAoiType || []),
      8
    ),
    primaryAoiName: typeof nearbySummary.primaryAoiName === 'string' ? nearbySummary.primaryAoiName : '',
    primaryAoiType: normalizedPrimaryAoiType,
    primaryAoiTypecode: normalizedPrimaryAoiTypecode,
    businessAreaNames: Array.isArray(nearbySummary.businessAreaNames)
      ? nearbySummary.businessAreaNames.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : [],
    activityHints: Array.isArray(nearbySummary.activityHints)
      ? nearbySummary.activityHints.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5)
      : [],
      source: typeof nearbySummary.source === 'string' ? nearbySummary.source : '',
    };
  if (memo) {
    memo.nearbySummary = result;
  }
  return result;
}

function normalizeRecentMissionHistory(event, limit = 10) {
  const memo = getRuntimeMemo(event);
  const memoKey = memo ? `recentMissionHistory:${limit}` : '';
  if (memo && memo[memoKey]) {
    return memo[memoKey];
  }
  const contextPacket = getContextPacket(event);
  const generationPacket = contextPacket.generation && typeof contextPacket.generation === 'object'
    ? contextPacket.generation
    : {};
  const rawHistory = Array.isArray(generationPacket.recentMissionHistory)
    ? generationPacket.recentMissionHistory
    : [];
  const fallbackHistory = !rawHistory.length && Array.isArray(generationPacket.previousMissions)
    ? generationPacket.previousMissions.map((mission) => ({ mission }))
    : [];
  const source = rawHistory.length ? rawHistory : fallbackHistory;
  const result = [];
  source.forEach((item) => {
    const entry = item && typeof item === 'object'
      ? item
      : { mission: item };
    const mission = compactMission(entry.mission || entry.text || entry.label || '', event && event.walkMode);
    if (!mission || result.some((existing) => existing.mission === mission)) {
      return;
    }
    result.push({
      mission,
      title: String(entry.title || '').trim(),
      category: String(entry.category || '').trim(),
      actionType: String(entry.actionType || '').trim(),
      anchor: String(entry.anchor || '').trim(),
      source: String(entry.source || '').trim(),
    });
  });
  const finalResult = result.slice(0, limit);
  if (memo) {
    memo[memoKey] = finalResult;
  }
  return finalResult;
}

function cleanText(text) {
  return String(text || '').replace(/\s+/g, '').replace(/[。！!；;]+$/g, '').trim();
}

function getGenerationSeed(event) {
  const generationContext = getGenerationContext(event);
  const contextPacket = generationContext.contextPacket && typeof generationContext.contextPacket === 'object'
    ? generationContext.contextPacket
    : {};
  return String(
    event.generationSeed
    || generationContext.generationSeed
    || (contextPacket.generation && contextPacket.generation.seed)
    || ''
  ).trim();
}

function hashStringToUnit(value) {
  const text = String(value || '');
  if (!text) {
    return 0;
  }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function rotateBySeed(values, seed, salt = '') {
  const source = Array.isArray(values) ? values.filter(Boolean) : [];
  if (source.length <= 1 || !seed) {
    return source;
  }
  const offset = Math.floor(hashStringToUnit(`${seed}|${salt}`) * source.length) % source.length;
  return source.slice(offset).concat(source.slice(0, offset));
}

function uniqText(values, limit = 8) {
  const result = [];
  (Array.isArray(values) ? values : [values]).forEach((item) => {
    const text = String(item || '').trim();
    if (text && !result.includes(text) && result.length < limit) {
      result.push(text);
    }
  });
  return result;
}

function clampText(text, maxLength) {
  const cleaned = cleanText(text);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return cleaned.slice(0, maxLength).replace(/[，、；：,.!?！？。]+$/g, '');
}

function compactMission(text, walkMode) {
  return cleanText(text);
}

function missionSignature(text) {
  return cleanText(text)
    .replace(/寻找|找到|记录|留意|观察|拍下|拍|一处|一个|一组|这里|此刻|现在|今天|附近|街区|地方|同时|为什么|最|让你|并且|并|再|一下/g, '');
}

function missionsAreSimilar(left, right) {
  const leftSignature = missionSignature(left);
  const rightSignature = missionSignature(right);
  if (!leftSignature || !rightSignature) {
    return false;
  }
  if (leftSignature === rightSignature) {
    return true;
  }
  const shorter = leftSignature.length <= rightSignature.length ? leftSignature : rightSignature;
  const longer = shorter === leftSignature ? rightSignature : leftSignature;
  return shorter.length >= 4 && longer.includes(shorter);
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

function isRecentMissionRepeat(mission, recentMissions) {
  return (Array.isArray(recentMissions) ? recentMissions : []).some((existing) => missionsAreSimilar(existing, mission));
}

function prioritizeSingleThemeSkeletons(skeletons, recentHistory = []) {
  const recentActions = recentHistory
    .map((item) => item.actionType || inferMissionActionType(item.mission))
    .filter(Boolean);
  const getLabel = (item) => String(item || '').split('：')[0].trim();
  return [...(Array.isArray(skeletons) ? skeletons : [])].sort((left, right) => {
    const leftPenalty = recentActions.includes(getLabel(left)) ? 1 : 0;
    const rightPenalty = recentActions.includes(getLabel(right)) ? 1 : 0;
    if (leftPenalty !== rightPenalty) {
      return leftPenalty - rightPenalty;
    }
    return 0;
  });
}

function normalizeCategoryList(categories) {
  return (Array.isArray(categories) ? categories : [categories])
    .map((item) => String(item || '').replace(/漫步/g, '').trim())
    .filter(Boolean);
}

const NON_NUMBER_COUNTING_PATTERN = /(?:^|[，。；、\s])(?:数清|数一数|数出|统计|记下数量|辨认编号|找出编号)|(?:数清|数一数|数出|统计).{0,12}(?:数量|编号|几个|多少|几处|几条|几层|几步|几次|几组|几扇|几片)|(?:几个|多少|编号|序号|票号|出口号|楼层|门牌)/;

const VALIDATION_MODE_CONFIG = {
  pure: {
    minThemeHits: 1,
    minAnchors: 1,
    minVarietyRatio: 1,
    allowSimilarPairs: 0,
    minScore: 70,
  },
  advanced: {
    minThemeHits: 2,
    minAnchors: 2,
    minVarietyRatio: 0.67,
    allowSimilarPairs: 0,
    minScore: 70,
  },
};

function isMissionTooGeneric(text) {
  const mission = cleanText(text);
  if (!mission) {
    return true;
  }
  return /找一处让你停下的细节|最贴近此刻的细节|观察一下周围|看看附近有什么|感受一下这里|寻找一个细节/.test(mission);
}

function containsDisallowedMissionAction(text, categories) {
  const normalizedCategories = normalizeCategoryList(categories || []);
  if (!normalizedCategories.length || normalizedCategories.includes('数字')) {
    return false;
  }
  return NON_NUMBER_COUNTING_PATTERN.test(String(text || ''));
}

function buildCategoryReviewRules(categories) {
  const normalizedCategories = normalizeCategoryList(categories || []);
  const lines = [
    '如果任务动作明显偏成别的主题，请判定为不通过并建议局部改写。',
    '如果主题不是“数字”，凡是以“数清、数一数、数出、统计、几个、多少、编号、序号”等计数或编号动作为核心的任务，都应视为跑偏。',
  ];
  if (normalizedCategories.length === 1 && normalizedCategories[0] === '形状') {
    lines.push('形状主题应稳定落在具体可见的形状特征上，例如方和圆、直和弯、宽和窄、高和低、尖角和圆角、整齐和歪斜，不要把核心动作写成数数或编号识别。');
    lines.push('形状主题不要默认写成“边角、边界、轮廓关系、线条变化”这类空泛套话，除非它明确指向了具体对象的具体特征。');
  }
  if (normalizedCategories.length === 1 && normalizedCategories[0] === '色彩') {
    lines.push('色彩主题应稳定落在颜色相关观察上，但不要把“气质、关系、边界”这类抽象词直接当任务对象，也不要把核心动作写成计数或编号识别。');
  }
  if (normalizedCategories.length === 1 && normalizedCategories[0] === '声音') {
    lines.push('声音主题应稳定落在声音相关观察上，但不要把“声音的边界、空间关系、声场秩序”这类抽象词直接当任务对象，也不能把核心动作写成计数或视觉统计。');
  }
  if (normalizedCategories.length === 1 && normalizedCategories[0] === '数字') {
    lines.push('数字主题应稳定落在数字判断、顺序、规则或数字线索上，但不要把“数字感、秩序感”这类抽象词直接当任务对象，也不要反复写成同一种编号或数数句式。');
  }
  if (normalizedCategories.length === 1 && normalizedCategories[0] === '气味') {
    lines.push('气味主题应稳定落在气味相关观察上，但不要把“气味的边界、氛围、状态”这类抽象词直接当任务对象，也不能把核心动作写成计数或编号识别。');
  }
  return lines;
}

function normalizeValidationPlanMeta(plan) {
  const normalizedPlan = plan && typeof plan === 'object' ? plan : {};
  return {
    plannerMode: typeof normalizedPlan.plannerMode === 'string' ? normalizedPlan.plannerMode : '',
    targetThemes: Array.isArray(normalizedPlan.targetThemes)
      ? normalizedPlan.targetThemes.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
      : [],
    focusThemes: Array.isArray(normalizedPlan.focusThemes)
      ? normalizedPlan.focusThemes.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
      : [],
    chosenScene: typeof normalizedPlan.chosenScene === 'string' ? normalizedPlan.chosenScene : '',
    primaryAnchors: Array.isArray(normalizedPlan.primaryAnchors)
      ? normalizedPlan.primaryAnchors.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : [],
    supportingScenes: Array.isArray(normalizedPlan.supportingScenes)
      ? normalizedPlan.supportingScenes.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
      : [],
    missionPlans: Array.isArray(normalizedPlan.missionPlans)
      ? normalizedPlan.missionPlans.slice(0, 4)
      : [],
    missionBlueprints: Array.isArray(normalizedPlan.missionBlueprints)
      ? normalizedPlan.missionBlueprints.slice(0, 4)
      : [],
    categoryPlans: Array.isArray(normalizedPlan.categoryPlans)
      ? normalizedPlan.categoryPlans.slice(0, 4)
      : [],
  };
}

const BASE_PREFERENCE_OBJECT_LIBRARY = {
  自然景观: {
    objects: [
      { label: '树影', level: 'safe', sceneKeywords: ['公园', '绿地', '小区', '校园', '广场', '景区', '园'], timePhases: ['上午', '午后', '黄昏'] },
      { label: '枝叶', level: 'safe', sceneKeywords: ['公园', '绿地', '小区', '校园', '园林', '树'] },
      { label: '树冠', level: 'safe', sceneKeywords: ['树', '公园', '小区', '校园', '园'] },
      { label: '花坛边', level: 'safe', sceneKeywords: ['花坛', '广场', '小区', '校园', '公园'] },
      { label: '花枝', level: 'safe', sceneKeywords: ['花', '园', '公园', '小区', '院'], seasons: ['春', '夏', '秋'] },
      { label: '草木边缘', level: 'safe', sceneKeywords: ['草', '绿地', '花坛', '公园', '校园'] },
      { label: '路边绿植', level: 'safe', sceneKeywords: ['小区', '街区', '校园', '广场', '路'] },
      { label: '天光', level: 'safe', timePhases: ['清晨', '上午', '午后', '黄昏'] },
      { label: '天边亮处', level: 'safe', timePhases: ['清晨', '黄昏'] },
      { label: '云层', level: 'safe', weathers: ['多云', '大风', '雨天'] },
      { label: '风吹过的叶面', level: 'safe', sceneKeywords: ['树', '叶', '公园', '绿地', '院'], weathers: ['大风', '多云'] },
      { label: '地上的叶子', level: 'safe', sceneKeywords: ['树', '路', '院', '公园'], seasons: ['秋', '冬', '春'] },
      { label: '泥土边', level: 'safe', sceneKeywords: ['花坛', '树池', '绿地', '公园'] },
      { label: '林荫道边', level: 'safe', sceneKeywords: ['公园', '校园', '小区', '园区', '景区', '路'] },
      { label: '花圃边', level: 'safe', sceneKeywords: ['公园', '广场', '校园', '景区', '园区', '花'] },
      { label: '草坡', level: 'safe', sceneKeywords: ['公园', '广场', '校园', '景区', '小区'] },
      { label: '竹影', level: 'safe', sceneKeywords: ['园林', '公园', '景区', '院', '校园'] },
      { label: '园路转弯处', level: 'safe', sceneKeywords: ['公园', '景区', '校园', '园区', '小区'] },
      { label: '绿篱边', level: 'safe', sceneKeywords: ['公园', '校园', '小区', '景区', '广场'] },
      { label: '落花边', level: 'safe', sceneKeywords: ['公园', '校园', '小区', '院', '花'], seasons: ['春', '夏', '秋'] },
      { label: '灌木边', level: 'safe', sceneKeywords: ['公园', '绿地', '小区', '校园', '景区'] },
      { label: '树皮纹路', level: 'safe', sceneKeywords: ['树', '公园', '校园', '景区', '院'] },
      { label: '草叶尖', level: 'safe', sceneKeywords: ['草', '绿地', '公园', '校园', '小区'] },
      { label: '树下阴影', level: 'scene-bound', sceneKeywords: ['树', '公园', '绿地', '院', '小区'], timePhases: ['上午', '午后', '黄昏'] },
      { label: '院里的树', level: 'scene-bound', sceneKeywords: ['院', '景区', '博物馆', '胡同'] },
      { label: '墙边植物', level: 'scene-bound', sceneKeywords: ['墙', '院', '校园', '小区'] },
      { label: '草地边', level: 'scene-bound', sceneKeywords: ['草坪', '公园', '广场', '校园'] },
      { label: '树池边', level: 'scene-bound', sceneKeywords: ['树池', '人行道', '街区', '广场', '小区'] },
      { label: '路边花箱', level: 'scene-bound', sceneKeywords: ['街区', '广场', '路边', '商场'] },
      { label: '草坪转角', level: 'scene-bound', sceneKeywords: ['草坪', '公园', '广场', '校园'] },
      { label: '树梢空隙', level: 'scene-bound', sceneKeywords: ['树', '天', '公园', '院'] },
      { label: '树干纹路', level: 'scene-bound', sceneKeywords: ['树', '院', '园', '公园'] },
      { label: '石边苔痕', level: 'scene-bound', sceneKeywords: ['石', '院', '园', '景区', '公园'], seasons: ['春', '夏', '秋'] },
      { label: '小喷泉', level: 'scene-bound', sceneKeywords: ['广场', '公园', '商场', '园区', '小区', '校园'] },
      { label: '风吹动的水纹', level: 'scene-bound', sceneKeywords: ['河', '湖', '水', '池', '滨水'], weathers: ['大风', '多云'] },
      { label: '水面', level: 'scene-bound', sceneKeywords: ['湖', '河', '水', '滨水', '池'], poiTypeKeywords: ['风景名胜', '公园广场'] },
      { label: '岸线', level: 'scene-bound', sceneKeywords: ['河', '湖', '岸', '滨水'] },
      { label: '倒影', level: 'scene-bound', sceneKeywords: ['水', '湖', '河', '池'], timePhases: ['上午', '午后', '黄昏', '夜间'] },
      { label: '桥下阴影', level: 'scene-bound', sceneKeywords: ['桥', '河', '湖', '水', '滨水'], timePhases: ['上午', '午后', '黄昏'] },
      { label: '岸边石头', level: 'scene-bound', sceneKeywords: ['岸', '河', '湖', '园', '石'] },
      { label: '水边台阶', level: 'scene-bound', sceneKeywords: ['湖', '河', '水', '滨水', '公园', '景区'] },
      { label: '湖边步道', level: 'scene-bound', sceneKeywords: ['湖', '河', '滨水', '公园', '景区'] },
      { label: '水生植物', level: 'scene-bound', sceneKeywords: ['湖', '河', '池', '湿地', '公园', '景区'], seasons: ['春', '夏', '秋'] },
      { label: '湿地边的草', level: 'scene-bound', sceneKeywords: ['湿地', '湖', '河', '岸', '公园', '景区'] },
      { label: '桥边水面', level: 'hard-evidence', sceneKeywords: ['桥', '河', '湖', '滨水'], poiNameKeywords: ['桥', '河', '湖', '水'] },
      { label: '柳枝', level: 'hard-evidence', sceneKeywords: ['柳', '湖', '河', '园', '岸'], poiNameKeywords: ['柳', '园'] },
      { label: '荷叶', level: 'hard-evidence', sceneKeywords: ['荷', '池', '湖', '水'], seasons: ['夏'] },
      { label: '水边栏杆外的景色', level: 'hard-evidence', sceneKeywords: ['滨水', '湖', '河', '桥'], poiNameKeywords: ['桥', '滨', '湖', '河'] },
      { label: '芦苇边', level: 'hard-evidence', sceneKeywords: ['湿地', '河', '湖', '岸', '景区'], seasons: ['秋', '冬'] },
      { label: '喷泉水雾', level: 'hard-evidence', sceneKeywords: ['喷泉', '广场', '公园', '商场', '园区'], timePhases: ['上午', '午后', '黄昏'] },
    ],
    avoid: ['招牌文案', '门牌编号', '促销字样'],
    instruction: '优先把任务对象落在树、水、天光、花草、风带来的痕迹上，不要把注意力先放到招牌、编号或说明字样上。',
  },
  人文历史: {
    objects: [
      { label: '门洞', level: 'safe', sceneKeywords: ['景区', '馆', '楼', '院', '胡同', '街区'] },
      { label: '窗框', level: 'safe', sceneKeywords: ['楼', '院', '馆', '建筑'] },
      { label: '台阶', level: 'safe', sceneKeywords: ['入口', '楼', '馆', '广场'] },
      { label: '墙面纹理', level: 'safe', sceneKeywords: ['墙', '院', '馆', '旧', '砖'] },
      { label: '墙角', level: 'safe', sceneKeywords: ['墙', '院', '馆', '街区', '胡同'] },
      { label: '砖缝', level: 'safe', sceneKeywords: ['砖', '墙', '胡同', '旧', '院'] },
      { label: '窗台边', level: 'safe', sceneKeywords: ['窗', '院', '楼', '馆'] },
      { label: '入口台基', level: 'safe', sceneKeywords: ['入口', '台基', '馆', '楼', '广场'] },
      { label: '旧式栏杆', level: 'safe', sceneKeywords: ['栏杆', '院', '景区', '楼', '馆'] },
      { label: '门框边线', level: 'safe', sceneKeywords: ['门', '框', '楼', '院', '馆'] },
      { label: '长窗格', level: 'safe', sceneKeywords: ['楼', '馆', '院', '校园', '建筑'] },
      { label: '柱脚', level: 'safe', sceneKeywords: ['楼', '馆', '门廊', '景区', '校园'] },
      { label: '石阶边线', level: 'safe', sceneKeywords: ['台阶', '入口', '馆', '楼', '景区'] },
      { label: '砖雕边', level: 'safe', sceneKeywords: ['砖', '墙', '门楼', '胡同', '故居'] },
      { label: '屋脊线', level: 'safe', sceneKeywords: ['屋脊', '楼', '寺', '祠', '院'] },
      { label: '门把手', level: 'safe', sceneKeywords: ['门', '馆', '楼', '校园', '院'] },
      { label: '墙砖边', level: 'safe', sceneKeywords: ['砖', '墙', '馆', '楼', '胡同'] },
      { label: '扶手转角', level: 'safe', sceneKeywords: ['扶手', '台阶', '馆', '楼', '校园'] },
      { label: '柱身线条', level: 'safe', sceneKeywords: ['柱', '门廊', '馆', '楼', '校园'] },
      { label: '檐下地面', level: 'safe', sceneKeywords: ['檐', '楼', '院', '馆', '景区'] },
      { label: '屋檐', level: 'scene-bound', sceneKeywords: ['故居', '祠', '寺', '楼', '宫', '院'] },
      { label: '牌匾', level: 'scene-bound', sceneKeywords: ['故居', '博物馆', '馆', '景区', '门楼'], poiNameKeywords: ['故宫', '故居', '博物馆', '纪念馆'] },
      { label: '檐角', level: 'scene-bound', sceneKeywords: ['檐', '楼', '宫', '寺', '塔'] },
      { label: '廊柱', level: 'scene-bound', sceneKeywords: ['馆', '楼', '广场', '纪念', '入口'] },
      { label: '旧墙转角', level: 'scene-bound', sceneKeywords: ['旧墙', '城墙', '胡同', '故居', '砖墙'] },
      { label: '铭牌', level: 'scene-bound', sceneKeywords: ['纪念', '博物馆', '展馆', '文化'] },
      { label: '立面细部', level: 'scene-bound', sceneKeywords: ['立面', '建筑', '楼', '馆'] },
      { label: '门前石阶', level: 'scene-bound', sceneKeywords: ['石阶', '入口', '馆', '楼', '景区'] },
      { label: '旧砖路面', level: 'scene-bound', sceneKeywords: ['砖', '胡同', '旧路', '院', '景区'] },
      { label: '檐下阴影', level: 'scene-bound', sceneKeywords: ['檐', '楼', '宫', '院'], timePhases: ['上午', '午后', '黄昏'] },
      { label: '旧木构件', level: 'scene-bound', sceneKeywords: ['木', '故居', '祠', '馆', '院'] },
      { label: '碑刻边缘', level: 'scene-bound', sceneKeywords: ['碑', '纪念', '馆', '景区'] },
      { label: '匾额边框', level: 'scene-bound', sceneKeywords: ['匾', '门楼', '景区', '馆'] },
      { label: '拐角砖面', level: 'scene-bound', sceneKeywords: ['胡同', '砖墙', '旧街', '巷'] },
      { label: '回廊转角', level: 'scene-bound', sceneKeywords: ['廊', '馆', '院', '景区', '校园'] },
      { label: '碑座', level: 'scene-bound', sceneKeywords: ['碑', '纪念', '馆', '景区', '校园'] },
      { label: '校门边线', level: 'scene-bound', sceneKeywords: ['学校', '校园', '门', '楼'] },
      { label: '图书馆门前台阶', level: 'scene-bound', sceneKeywords: ['图书馆', '馆', '学校', '校园'] },
      { label: '校史墙', level: 'scene-bound', sceneKeywords: ['校园', '学校', '馆', '历史'] },
      { label: '门环', level: 'hard-evidence', sceneKeywords: ['门', '故居', '院', '祠'], poiNameKeywords: ['故居', '故宫', '祠', '寺'] },
      { label: '牌坊', level: 'hard-evidence', sceneKeywords: ['牌坊', '城楼', '景区'], poiNameKeywords: ['牌坊', '城楼', '祠', '寺'] },
      { label: '拱门', level: 'hard-evidence', sceneKeywords: ['拱门', '门洞', '景区', '馆'], poiNameKeywords: ['门', '城', '故居'] },
      { label: '石栏杆', level: 'hard-evidence', sceneKeywords: ['石', '桥', '台基', '景区'], poiNameKeywords: ['桥', '宫', '园'] },
      { label: '城楼边线', level: 'hard-evidence', sceneKeywords: ['城楼', '角楼', '城门'], poiNameKeywords: ['城楼', '角楼', '城门'] },
      { label: '宫墙边沿', level: 'hard-evidence', sceneKeywords: ['宫墙', '城墙', '故宫', '坛'], poiNameKeywords: ['故宫', '城', '坛'] },
      { label: '牌楼立柱', level: 'hard-evidence', sceneKeywords: ['牌楼', '牌坊', '门楼'], poiNameKeywords: ['牌坊', '门楼'] },
      { label: '旧门钉', level: 'hard-evidence', sceneKeywords: ['门钉', '宫', '院', '故居'], poiNameKeywords: ['故宫', '故居', '祠', '寺'] },
      { label: '钟楼边线', level: 'hard-evidence', sceneKeywords: ['钟楼', '校', '楼', '景区'], poiNameKeywords: ['钟楼', '学校', '大学'] },
      { label: '石狮底座', level: 'hard-evidence', sceneKeywords: ['石狮', '门口', '景区', '馆', '院'], poiNameKeywords: ['故居', '博物馆', '祠', '寺', '门楼'] },
      { label: '城墙垛口', level: 'hard-evidence', sceneKeywords: ['城墙', '城门', '城楼', '景区'], poiNameKeywords: ['城墙', '城门', '城楼'] },
      { label: '校训碑', level: 'hard-evidence', sceneKeywords: ['学校', '校园', '碑', '校训'], poiNameKeywords: ['大学', '学院', '中学', '学校'] },
    ],
    avoid: ['奶茶杯', '外卖袋', '促销海报'],
    instruction: '优先看建筑细部、旧构件、门窗台阶、石砖牌匾这些有人文和历史感的对象，不要先落到临时消费物和商业广告上。',
  },
  市井烟火: {
    objects: [
      { label: '店门口', level: 'safe', sceneKeywords: ['店', '街', '商业', '商场', '小区', '站'] },
      { label: '招牌', level: 'safe', sceneKeywords: ['商业', '餐饮', '街区', '站口', '小店'] },
      { label: '排队的人', level: 'safe', sceneKeywords: ['餐饮', '站', '商场', '写字楼'], timePhases: ['上午', '午后', '黄昏', '夜间'] },
      { label: '外带口', level: 'safe', sceneKeywords: ['咖啡', '外卖', '餐饮', '站口'] },
      { label: '店外停留的人', level: 'safe', sceneKeywords: ['店', '街', '商场', '站', '小区'] },
      { label: '门口小桌', level: 'safe', sceneKeywords: ['店', '餐饮', '咖啡', '小吃'] },
      { label: '门边价牌', level: 'safe', sceneKeywords: ['店', '菜单', '价牌', '商店'] },
      { label: '取餐的人', level: 'safe', sceneKeywords: ['外卖', '餐饮', '咖啡', '站口'], timePhases: ['上午', '午后', '黄昏', '夜间'] },
      { label: '纸袋杯套', level: 'safe', sceneKeywords: ['咖啡', '外带', '餐饮', '商场'] },
      { label: '便利店冰柜', level: 'safe', sceneKeywords: ['便利店', '商店', '站口', '小区', '写字楼'] },
      { label: '水果筐', level: 'safe', sceneKeywords: ['水果', '市场', '店门口', '商店', '小区'] },
      { label: '面包柜', level: 'safe', sceneKeywords: ['面包', '糕饼', '店', '商场', '写字楼'] },
      { label: '自动售货机', level: 'safe', sceneKeywords: ['站口', '商场', '写字楼', '校园', '园区'] },
      { label: '快递柜', level: 'safe', sceneKeywords: ['小区', '写字楼', '园区', '校园', '门口'] },
      { label: '外摆椅', level: 'safe', sceneKeywords: ['咖啡', '餐饮', '店门口', '商圈', '步行街'] },
      { label: '店门把手', level: 'safe', sceneKeywords: ['店', '商场', '商圈', '步行街', '小区'] },
      { label: '外卖架', level: 'safe', sceneKeywords: ['外卖', '店门口', '写字楼', '商圈', '站口'] },
      { label: '柜台边', level: 'safe', sceneKeywords: ['柜台', '店', '商场', '便利店', '餐饮'] },
      { label: '取号牌', level: 'safe', sceneKeywords: ['取号', '餐饮', '咖啡', '店门口', '商场'] },
      { label: '冷柜门', level: 'safe', sceneKeywords: ['便利店', '超市', '商店', '商场', '小区'] },
      { label: '收银口', level: 'scene-bound', sceneKeywords: ['便利店', '餐饮', '商店', '咖啡'] },
      { label: '打包台', level: 'scene-bound', sceneKeywords: ['外卖', '餐饮', '咖啡', '打包'] },
      { label: '小推车', level: 'scene-bound', sceneKeywords: ['摊', '站', '夜市', '菜', '集市'] },
      { label: '价签', level: 'scene-bound', sceneKeywords: ['店', '超市', '菜', '档口'] },
      { label: '蒸汽', level: 'scene-bound', sceneKeywords: ['餐饮', '早餐', '小吃', '面', '包子'], timePhases: ['清晨', '上午', '黄昏', '夜间'] },
      { label: '餐桌边', level: 'scene-bound', sceneKeywords: ['餐饮', '咖啡', '小吃', '饭馆'] },
      { label: '菜单牌', level: 'scene-bound', sceneKeywords: ['菜单', '餐饮', '咖啡', '小吃'] },
      { label: '一次性餐具', level: 'scene-bound', sceneKeywords: ['外卖', '餐饮', '桌', '打包'] },
      { label: '等餐的人', level: 'scene-bound', sceneKeywords: ['餐饮', '外卖', '咖啡', '站口'], timePhases: ['上午', '午后', '黄昏', '夜间'] },
      { label: '塑料凳', level: 'scene-bound', sceneKeywords: ['小吃', '摊', '店门口', '早餐'] },
      { label: '打包袋', level: 'scene-bound', sceneKeywords: ['外卖', '打包', '餐饮', '咖啡'] },
      { label: '便利店门边', level: 'scene-bound', sceneKeywords: ['便利店', '商店', '站口', '写字楼'] },
      { label: '快递堆放点', level: 'scene-bound', sceneKeywords: ['快递', '小区', '写字楼', '门口'] },
      { label: '小卖部台面', level: 'scene-bound', sceneKeywords: ['小卖部', '校园', '小区', '站口'] },
      { label: '熟食柜台', level: 'scene-bound', sceneKeywords: ['熟食', '超市', '市场', '档口', '商场'] },
      { label: '饮品封口台', level: 'scene-bound', sceneKeywords: ['奶茶', '饮品', '咖啡', '外带', '商场'] },
      { label: '菜市场过道', level: 'scene-bound', sceneKeywords: ['市场', '菜', '档口', '摊', '商圈'] },
      { label: '收货小推板车', level: 'scene-bound', sceneKeywords: ['商店', '超市', '市场', '写字楼', '后门'] },
      { label: '摊位', level: 'hard-evidence', sceneKeywords: ['摊', '夜市', '集市', '早餐'], poiTypeKeywords: ['餐饮服务', '购物服务'] },
      { label: '档口台面', level: 'hard-evidence', sceneKeywords: ['档口', '小吃', '市场', '餐饮'], poiTypeKeywords: ['餐饮服务'] },
      { label: '后厨窗口', level: 'hard-evidence', sceneKeywords: ['后厨', '档口', '餐饮'], poiTypeKeywords: ['餐饮服务'] },
      { label: '早餐摊', level: 'hard-evidence', sceneKeywords: ['早餐', '早点', '摊', '站口'], timePhases: ['清晨', '上午'] },
      { label: '夜市摊', level: 'hard-evidence', sceneKeywords: ['夜市', '摊', '小吃', '集市'], timePhases: ['黄昏', '夜间'] },
      { label: '烤炉边', level: 'hard-evidence', sceneKeywords: ['烤', '串', '餐饮', '夜市'], timePhases: ['黄昏', '夜间'] },
      { label: '菜摊台面', level: 'hard-evidence', sceneKeywords: ['菜', '市场', '摊', '档口'], poiTypeKeywords: ['购物服务'] },
      { label: '站口小店', level: 'hard-evidence', sceneKeywords: ['站口', '地铁', '公交', '小店'], poiNameKeywords: ['站', '地铁', '公交'] },
      { label: '咖啡外带口', level: 'hard-evidence', sceneKeywords: ['咖啡', '外带', '写字楼', '站口'], poiTypeKeywords: ['餐饮服务'] },
      { label: '奶茶取杯台', level: 'hard-evidence', sceneKeywords: ['奶茶', '饮品', '外带', '商圈', '站口'] },
      { label: '面包出炉口', level: 'hard-evidence', sceneKeywords: ['面包', '烘焙', '糕饼', '店', '商场'] },
      { label: '快递车', level: 'hard-evidence', sceneKeywords: ['快递', '小区', '写字楼', '园区', '门口'] },
      { label: '地铁口闸外小店', level: 'hard-evidence', sceneKeywords: ['地铁', '站口', '小店', '商圈', '写字楼'], poiNameKeywords: ['地铁站', '站'] },
    ],
    avoid: ['树冠', '云层', '纯风景视角'],
    instruction: '优先看摊位、门口、招牌、排队、冒热气的地方和人与货物打交道的痕迹，不要把任务写成纯风景观察。',
  },
};

function assignNativeHints(target, labels, patch) {
  labels.forEach((label) => {
    target[label] = Object.assign({}, target[label] || {}, patch);
  });
}

function buildPreferenceObjectNativeHints() {
  const hints = {
    自然景观: {},
    人文历史: {},
    市井烟火: {},
  };

  assignNativeHints(hints.自然景观, [
    '树影', '枝叶', '树冠', '花坛边', '花枝', '草木边缘', '路边绿植', '地上的叶子', '泥土边',
    '林荫道边', '花圃边', '草坡', '竹影', '园路转弯处', '绿篱边', '落花边', '灌木边', '树皮纹路', '草叶尖',
    '树下阴影', '草地边', '树池边', '路边花箱', '草坪转角', '树梢空隙', '树干纹路',
  ], {
    typecodePrefixes: ['0605', '1101', '1102', '11', '1203', '1412'],
    aoiTypecodePrefixes: ['060500', '060501', '110100', '110101', '110102', '110103', '110105', '120300', '120302', '120303', '141200', '141201', '141202', '141203', '141204', '141207'],
    aoiKeywords: ['花鸟鱼虫市场', '花卉市场', '公园广场', '公园', '动物园', '植物园', '城市广场', '住宅区', '住宅小区', '宿舍', '学校', '高等院校', '中学', '小学', '幼儿园', '学校内部设施'],
    poiTypeKeywords: ['风景名胜', '公园广场', '花鸟鱼虫市场', '住宅区', '学校'],
  });
  assignNativeHints(hints.自然景观, ['小喷泉', '喷泉水雾'], {
    typecodePrefixes: ['1101', '1201', '1202', '1203', '1412'],
    aoiTypecodePrefixes: ['110105', '120100', '120200', '120201', '120203', '120300', '120302', '141200', '141201', '141202', '141207'],
    aoiKeywords: ['城市广场', '产业园区', '楼宇相关', '商务写字楼', '商住两用楼宇', '住宅区', '住宅小区', '学校', '高等院校', '中学', '学校内部设施'],
    poiTypeKeywords: ['风景名胜', '公园广场', '商务住宅', '住宅区', '学校'],
  });
  assignNativeHints(hints.自然景观, ['院里的树', '墙边植物', '石边苔痕'], {
    typecodePrefixes: ['1102', '14', '1203'],
    aoiTypecodePrefixes: ['110204', '110205', '110206', '110207', '140100', '140200', '140400', '140500', '140800', '140900', '120300', '120302', '141200', '141201', '141207'],
    aoiKeywords: ['纪念馆', '寺庙道观', '教堂', '回教寺', '博物馆', '展览馆', '美术馆', '图书馆', '文化宫', '档案馆', '住宅区', '住宅小区', '学校', '高等院校', '学校内部设施'],
  });
  assignNativeHints(hints.自然景观, [
    '风吹动的水纹', '水面', '岸线', '倒影', '桥下阴影', '岸边石头', '水边台阶', '湖边步道',
    '水生植物', '湿地边的草', '桥边水面', '荷叶', '水边栏杆外的景色', '芦苇边',
  ], {
    typecodePrefixes: ['1101', '1102', '11'],
    aoiTypecodePrefixes: ['110101', '110103', '110105', '110200', '110201', '110202', '110203'],
    aoiKeywords: ['植物园', '城市广场', '世界遗产', '国家级景点', '省级景点'],
    aoiAliasKeywords: ['公园', '景区', '湿地', '河', '湖', '水'],
    poiNameKeywords: ['桥', '河', '湖', '水', '园', '湿地'],
    poiTypeKeywords: ['风景名胜', '公园广场'],
  });
  assignNativeHints(hints.自然景观, ['柳枝'], {
    typecodePrefixes: ['1101', '1102', '11'],
    aoiTypecodePrefixes: ['110101', '110103', '110105', '110200', '110202', '120302'],
    aoiKeywords: ['公园', '植物园', '城市广场', '风景名胜', '国家级景点', '住宅小区'],
    poiNameKeywords: ['柳', '桥', '河', '湖', '园'],
  });

  assignNativeHints(hints.人文历史, [
    '门洞', '窗框', '台阶', '墙面纹理', '墙角', '砖缝', '窗台边', '入口台基', '旧式栏杆', '门框边线',
    '长窗格', '柱脚', '石阶边线', '砖雕边', '屋脊线', '门把手', '墙砖边', '扶手转角', '柱身线条', '檐下地面',
    '屋檐', '牌匾', '檐角', '廊柱', '旧墙转角', '铭牌', '立面细部', '门前石阶', '旧砖路面',
    '檐下阴影', '旧木构件', '碑刻边缘', '匾额边框', '拐角砖面', '回廊转角', '碑座', '校门边线',
    '图书馆门前台阶', '校史墙',
  ], {
    typecodePrefixes: ['1102', '1401', '1402', '1404', '1405', '1408', '1409', '1412', '14'],
    aoiTypecodePrefixes: ['110204', '110205', '110206', '110207', '140100', '140200', '140400', '140500', '140800', '140900', '141200', '141201', '141202', '141203', '141207'],
    aoiKeywords: ['纪念馆', '寺庙道观', '教堂', '回教寺', '博物馆', '展览馆', '美术馆', '图书馆', '文化宫', '档案馆', '学校', '高等院校', '中学', '小学', '学校内部设施'],
    aoiAliasKeywords: ['校园', '校门', '校史', '古建', '旧墙', '门楼'],
    poiTypeKeywords: ['风景名胜', '科教文化服务', '博物馆', '图书馆', '学校'],
  });
  assignNativeHints(hints.人文历史, [
    '门环', '牌坊', '拱门', '石栏杆', '城楼边线', '宫墙边沿', '牌楼立柱', '旧门钉',
    '钟楼边线', '石狮底座', '城墙垛口', '校训碑',
  ], {
    typecodePrefixes: ['1102', '1401', '1402', '1404', '1405', '1408', '1412', '14'],
    aoiTypecodePrefixes: ['110201', '110202', '110203', '110204', '110205', '110206', '110207', '140100', '140200', '140400', '140500', '140800', '141200', '141201', '141202'],
    aoiKeywords: ['世界遗产', '国家级景点', '省级景点', '纪念馆', '寺庙道观', '教堂', '回教寺', '博物馆', '展览馆', '美术馆', '图书馆', '文化宫', '学校', '高等院校', '中学'],
  });

  assignNativeHints(hints.市井烟火, [
    '店门口', '招牌', '排队的人', '外带口', '店外停留的人', '门口小桌', '门边价牌', '取餐的人', '纸袋杯套',
    '便利店冰柜', '水果筐', '面包柜', '自动售货机', '快递柜', '外摆椅', '店门把手', '外卖架', '柜台边', '取号牌', '冷柜门',
    '收银口', '打包台', '价签', '蒸汽', '餐桌边', '菜单牌', '一次性餐具', '等餐的人', '塑料凳',
    '打包袋', '便利店门边', '快递堆放点', '小卖部台面', '熟食柜台', '饮品封口台', '菜市场过道',
    '收货小推板车',
  ], {
    typecodePrefixes: ['05', '0508', '0509', '06', '0602', '0604', '0607', '0610', '07', '0705', '1505', '1507'],
    aoiTypecodePrefixes: ['050300', '050400', '050500', '050600', '050800', '050900', '060200', '060400', '060700', '061000', '061001', '070500', '120201', '120203', '120302', '120304', '150500', '150501', '150700', '150702'],
    aoiKeywords: ['快餐厅', '休闲餐饮场所', '咖啡厅', '茶艺馆', '糕饼店', '甜品店', '便民商店/便利店', '超级市场', '综合市场', '特色商业街', '步行街', '物流速递', '商务写字楼', '商住两用楼宇', '住宅小区', '社区中心', '地铁站', '出入口', '公交车站', '普通公交站'],
    aoiAliasKeywords: ['商圈', '商业街', '市场', '店', '档口', '外带'],
    businessAreaKeywords: ['商圈', '广场', '步行街', '商业街', '市场', '美食街'],
    poiTypeKeywords: ['餐饮服务', '购物服务', '生活服务', '交通设施服务'],
  });
  assignNativeHints(hints.市井烟火, [
    '小推车', '摊位', '档口台面', '后厨窗口', '早餐摊', '夜市摊', '烤炉边', '菜摊台面',
    '水果筐', '熟食柜台', '菜市场过道',
  ], {
    typecodePrefixes: ['0503', '0504', '0505', '0506', '0604', '0607', '0610'],
    aoiTypecodePrefixes: ['050300', '050400', '050500', '050600', '060700', '060703', '060704', '060705', '060706', '061000', '061001'],
    aoiKeywords: ['快餐厅', '休闲餐饮场所', '咖啡厅', '茶艺馆', '综合市场', '农副产品市场', '果品市场', '蔬菜市场', '水产海鲜市场', '特色商业街', '步行街'],
    businessAreaKeywords: ['美食街', '步行街', '市场', '夜市'],
  });
  assignNativeHints(hints.市井烟火, ['面包柜', '面包出炉口'], {
    typecodePrefixes: ['0508', '0509', '0504', '0610'],
    aoiTypecodePrefixes: ['050800', '050900', '050400', '061000', '061001', '120201'],
    aoiKeywords: ['糕饼店', '甜品店', '休闲餐饮场所', '特色商业街', '步行街', '商务写字楼'],
    businessAreaKeywords: ['商圈', '步行街'],
    poiTypeKeywords: ['餐饮服务', '糕饼店', '甜品店'],
  });
  assignNativeHints(hints.市井烟火, ['饮品封口台', '奶茶取杯台', '外摆椅', '咖啡外带口'], {
    typecodePrefixes: ['0504', '0505', '0506', '0509', '0610', '15'],
    aoiTypecodePrefixes: ['050400', '050500', '050600', '050900', '061000', '061001', '120201', '150500', '150501', '150700', '150702'],
    aoiKeywords: ['休闲餐饮场所', '咖啡厅', '茶艺馆', '甜品店', '特色商业街', '步行街', '商务写字楼', '地铁站', '出入口', '公交车站', '普通公交站'],
    businessAreaKeywords: ['商圈', '步行街', '美食街'],
    poiTypeKeywords: ['餐饮服务', '咖啡厅', '茶艺馆', '甜品店'],
  });
  assignNativeHints(hints.市井烟火, ['便利店冰柜', '自动售货机', '快递柜', '快递车', '收货小推板车'], {
    typecodePrefixes: ['0602', '0604', '0705', '1505', '1507'],
    aoiTypecodePrefixes: ['060200', '060400', '070500', '070501', '120201', '120203', '120302', '120304', '141207', '150500', '150501', '150700', '150702'],
    aoiKeywords: ['便民商店/便利店', '超级市场', '物流速递', '物流仓储场地', '商务写字楼', '商住两用楼宇', '住宅小区', '社区中心', '学校内部设施', '地铁站', '出入口', '公交车站', '普通公交站'],
    aoiAliasKeywords: ['便利店', '超市', '快递', '站口'],
    poiTypeKeywords: ['购物服务', '生活服务', '物流速递', '交通设施服务'],
  });
  assignNativeHints(hints.市井烟火, ['站口小店'], {
    typecodePrefixes: ['06', '15'],
    aoiTypecodePrefixes: ['060200', '061000', '061001', '150200', '150203', '150500', '150501', '150700', '150702'],
    aoiKeywords: ['便民商店/便利店', '特色商业街', '步行街', '火车站', '出站口', '地铁站', '出入口', '公交车站', '普通公交站'],
  });
  assignNativeHints(hints.市井烟火, ['地铁口闸外小店'], {
    typecodePrefixes: ['0602', '0610', '1505'],
    aoiTypecodePrefixes: ['060200', '061000', '061001', '150500', '150501'],
    aoiKeywords: ['便民商店/便利店', '特色商业街', '步行街', '地铁站', '出入口'],
    poiTypeKeywords: ['购物服务', '交通设施服务'],
  });

  return hints;
}

function mergeUniqueFieldList(left, right) {
  return uniqText([].concat(left || []).concat(right || []), 20);
}

function finalizePreferenceObjectLibrary(baseLibrary, nativeHints) {
  return Object.keys(baseLibrary || {}).reduce((result, preference) => {
    const config = baseLibrary[preference] || {};
    const hintBucket = nativeHints && nativeHints[preference] ? nativeHints[preference] : {};
    result[preference] = Object.assign({}, config, {
      objects: Array.isArray(config.objects)
        ? config.objects.map((item) => {
          const hint = hintBucket[item.label] || {};
          return Object.assign({}, item, {
            sceneKeywords: mergeUniqueFieldList(item.sceneKeywords, hint.sceneKeywords),
            typecodePrefixes: mergeUniqueFieldList(item.typecodePrefixes, hint.typecodePrefixes),
            aoiTypecodePrefixes: mergeUniqueFieldList(item.aoiTypecodePrefixes, hint.aoiTypecodePrefixes),
            aoiKeywords: mergeUniqueFieldList(item.aoiKeywords, hint.aoiKeywords),
            aoiAliasKeywords: mergeUniqueFieldList(item.aoiAliasKeywords, hint.aoiAliasKeywords),
            businessAreaKeywords: mergeUniqueFieldList(item.businessAreaKeywords, hint.businessAreaKeywords),
            poiTypeKeywords: mergeUniqueFieldList(item.poiTypeKeywords, hint.poiTypeKeywords),
            poiNameKeywords: mergeUniqueFieldList(item.poiNameKeywords, hint.poiNameKeywords),
          });
        })
        : [],
    });
    return result;
  }, {});
}

const PREFERENCE_OBJECT_NATIVE_HINTS = buildPreferenceObjectNativeHints();
const PREFERENCE_OBJECT_LIBRARY = finalizePreferenceObjectLibrary(BASE_PREFERENCE_OBJECT_LIBRARY, PREFERENCE_OBJECT_NATIVE_HINTS);
const GLOBAL_SAFE_OBJECT_GROUPS = Object.keys(PREFERENCE_OBJECT_LIBRARY).reduce((result, preference) => {
  const config = PREFERENCE_OBJECT_LIBRARY[preference] || {};
  result[preference] = uniqText(
    (Array.isArray(config.objects) ? config.objects : [])
      .filter((item) => item && item.level === 'safe')
      .map((item) => item.label),
    12
  );
  return result;
}, {});

function buildGlobalSafeObjects(event, limit = 12) {
  const seed = getGenerationSeed(event);
  const preferenceKeys = Object.keys(GLOBAL_SAFE_OBJECT_GROUPS);
  const orderedKeys = rotateBySeed(preferenceKeys, seed, 'global-safe-groups');
  const rotatedGroups = orderedKeys.map((key, index) => rotateBySeed(
    GLOBAL_SAFE_OBJECT_GROUPS[key] || [],
    seed,
    `global-safe:${key}:${index}`
  ));
  const result = [];
  let cursor = 0;
  while (result.length < limit) {
    let appended = false;
    for (let index = 0; index < rotatedGroups.length; index += 1) {
      const candidate = rotatedGroups[index][cursor];
      if (candidate && !result.includes(candidate)) {
        result.push(candidate);
        appended = true;
        if (result.length >= limit) {
          break;
        }
      }
    }
    if (!appended) {
      break;
    }
    cursor += 1;
  }
  return result;
}

const PREFERENCE_LEVEL_THRESHOLD = {
  safe: 1.5,
  'scene-bound': 3.5,
  'hard-evidence': 5.5,
};

const WATER_OBJECT_LABELS = new Set([
  '风吹动的水纹', '水面', '岸线', '倒影', '桥下阴影', '岸边石头', '水边台阶', '湖边步道',
  '水生植物', '湿地边的草', '桥边水面', '荷叶', '水边栏杆外的景色', '芦苇边', '喷泉水雾', '小喷泉', '柳枝',
]);

const HISTORIC_STRONG_LABELS = new Set([
  '门环', '牌坊', '拱门', '石栏杆', '城楼边线', '宫墙边沿', '牌楼立柱', '旧门钉',
  '钟楼边线', '石狮底座', '城墙垛口', '校训碑',
]);

const MARKET_STRONG_LABELS = new Set([
  '摊位', '档口台面', '后厨窗口', '早餐摊', '夜市摊', '烤炉边', '菜摊台面',
]);

const WATER_EVIDENCE_KEYWORDS = ['河', '湖', '水', '湿地', '滨水', '桥', '喷泉', '公园', '风景名胜', '公园广场', '景区'];
const HISTORIC_EVIDENCE_KEYWORDS = ['故宫', '博物馆', '纪念馆', '展览馆', '美术馆', '图书馆', '文化宫', '档案馆', '寺', '祠', '牌坊', '门楼', '城楼', '城墙', '风景名胜', '学校', '校园'];
const MARKET_EVIDENCE_KEYWORDS = ['餐饮', '快餐', '咖啡', '茶艺', '糕饼', '甜品', '便利店', '超市', '市场', '商业街', '步行街', '地铁站', '公交车站', '商场', '店', '物流'];
const URBAN_CONFLICT_KEYWORDS = ['商务写字楼', '楼宇', '住宅区', '停车场', '地铁站', '公交车站', '物流速递', '生活服务', '购物服务', '商场', '商圈'];
const QUIET_CONFLICT_KEYWORDS = ['博物馆', '图书馆', '美术馆', '展览馆', '纪念馆', '公园', '风景名胜', '学校', '住宅区'];

function normalizeEnvironmentContext(event) {
  const memo = getRuntimeMemo(event);
  if (memo && memo.environmentContext) {
    return memo.environmentContext;
  }
  const contextPacket = getContextPacket(event);
  const result = {
    season: String(event.season || contextPacket.season || '').trim(),
    weather: String(event.weather || contextPacket.weather || '').trim(),
  };
  if (memo) {
    memo.environmentContext = result;
  }
  return result;
}

function includesAnyKeyword(values, keywords) {
  if (!Array.isArray(values) || !Array.isArray(keywords) || !keywords.length) {
    return false;
  }
  return values.some((value) => {
    const text = String(value || '').trim();
    return text && keywords.some((keyword) => keyword && text.includes(keyword));
  });
}

function collectKeywordMatches(values, keywords, limit = 4) {
  if (!Array.isArray(values) || !Array.isArray(keywords) || !keywords.length) {
    return [];
  }
  const matches = [];
  values.forEach((value) => {
    const text = String(value || '').trim();
    if (!text) {
      return;
    }
    if (keywords.some((keyword) => keyword && text.includes(keyword)) && !matches.includes(text)) {
      matches.push(text);
    }
  });
  return matches.slice(0, limit);
}

function matchesTypecodePrefix(values, prefixes) {
  if (!Array.isArray(values) || !Array.isArray(prefixes) || !prefixes.length) {
    return false;
  }
  return values.some((value) => {
    const text = String(value || '').trim();
    return text && prefixes.some((prefix) => prefix && text.startsWith(String(prefix).trim()));
  });
}

function collectTypecodeMatches(values, prefixes, limit = 4) {
  if (!Array.isArray(values) || !Array.isArray(prefixes) || !prefixes.length) {
    return [];
  }
  const matches = [];
  values.forEach((value) => {
    const text = String(value || '').trim();
    if (!text) {
      return;
    }
    if (prefixes.some((prefix) => prefix && text.startsWith(String(prefix).trim())) && !matches.includes(text)) {
      matches.push(text);
    }
  });
  return matches.slice(0, limit);
}

function isNativeTypecode(value) {
  return /^\d{4,6}$/.test(String(value || '').trim());
}

function calculateLayerScore(groups, layerCap = Infinity) {
  let score = 0;
  const reasons = [];
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    const matches = Array.isArray(group.matches) ? group.matches : [];
    if (!matches.length) {
      return;
    }
    const extraHitCount = Math.max(0, matches.length - 1);
    let contribution = Number(group.base || 0) + (Math.min(extraHitCount, Number(group.extraCap || 0)) * Number(group.extra || 0));
    if (Number.isFinite(Number(group.cap))) {
      contribution = Math.min(contribution, Number(group.cap));
    }
    score += contribution;
    if (group.reason) {
      reasons.push(group.reason);
    }
  });
  return {
    score: Number(Math.min(score, layerCap).toFixed(2)),
    reasons: uniqText(reasons, 8),
  };
}

function buildEvidenceKeywordPool(evidence) {
  return uniqText([
    ...(evidence.poiNames || []),
    ...(evidence.poiTypes || []),
    ...(evidence.aoiTexts || []),
    ...(evidence.nativeCategoryTexts || []),
    ...(evidence.businessAreaTexts || []),
    ...(evidence.contextTexts || []),
  ], 40);
}

function scoreConflictPenalty(candidate, evidence) {
  const evidenceTexts = buildEvidenceKeywordPool(evidence);
  const penaltyReasons = [];
  let penaltyScore = 0;
  const hasWaterEvidence = includesAnyKeyword(evidenceTexts, WATER_EVIDENCE_KEYWORDS);
  const hasHistoricEvidence = includesAnyKeyword(evidenceTexts, HISTORIC_EVIDENCE_KEYWORDS);
  const hasMarketEvidence = includesAnyKeyword(evidenceTexts, MARKET_EVIDENCE_KEYWORDS);
  const hasUrbanConflict = includesAnyKeyword(evidenceTexts, URBAN_CONFLICT_KEYWORDS);
  const hasQuietConflict = includesAnyKeyword(evidenceTexts, QUIET_CONFLICT_KEYWORDS);

  if (WATER_OBJECT_LABELS.has(candidate.label) && !hasWaterEvidence && hasUrbanConflict) {
    penaltyScore += 2.5;
    penaltyReasons.push('缺少水域或园景锚点');
  }

  if (HISTORIC_STRONG_LABELS.has(candidate.label) && !hasHistoricEvidence && hasUrbanConflict) {
    penaltyScore += 3;
    penaltyReasons.push('缺少明确人文历史锚点');
  }

  if (MARKET_STRONG_LABELS.has(candidate.label) && !hasMarketEvidence && hasQuietConflict) {
    penaltyScore += 2.5;
    penaltyReasons.push('缺少明确市井经营锚点');
  }

  if (Array.isArray(candidate.timePhases) && candidate.timePhases.length && evidence.timePhase && !candidate.timePhases.includes(evidence.timePhase)) {
    penaltyScore += 1.5;
    penaltyReasons.push('当前时间段不匹配');
  }
  if (Array.isArray(candidate.seasons) && candidate.seasons.length && evidence.season && !candidate.seasons.includes(evidence.season)) {
    penaltyScore += 1;
    penaltyReasons.push('当前季节不匹配');
  }
  if (Array.isArray(candidate.weathers) && candidate.weathers.length && evidence.weather && !candidate.weathers.includes(evidence.weather)) {
    penaltyScore += 1;
    penaltyReasons.push('当前天气不匹配');
  }

  return {
    penaltyScore: Number(penaltyScore.toFixed(2)),
    penaltyReasons: uniqText(penaltyReasons, 6),
  };
}

function scorePreferenceObjectCandidate(candidate, evidence) {
  const threshold = PREFERENCE_LEVEL_THRESHOLD[candidate.level] || 3;
  let score = candidate.level === 'safe' ? 1 : 0;
  const baseScore = candidate.level === 'safe' ? 0.5 : 0;
  const reasons = [];
  const nativeCategoryPrefixes = uniqText(
    Array.isArray(candidate.typecodePrefixes) ? candidate.typecodePrefixes : [],
    10
  );
  const matchedNativeCategoryCodes = collectTypecodeMatches(evidence.nativeCategoryCodes, nativeCategoryPrefixes);
  const matchedNativeCategoryTexts = collectKeywordMatches(evidence.nativeCategoryTexts, candidate.sceneKeywords || []);
  const matchedContextTexts = collectKeywordMatches(evidence.contextTexts, candidate.sceneKeywords || []);
  const matchedPoiTypes = collectKeywordMatches(evidence.poiTypes, candidate.poiTypeKeywords || []);
  const matchedPoiTypecodes = collectTypecodeMatches(evidence.poiTypecodes, candidate.typecodePrefixes || []);
  const matchedPoiNames = collectKeywordMatches(evidence.poiNames, candidate.poiNameKeywords || []);
  const matchedAoiTypecodes = collectTypecodeMatches(evidence.aoiTypecodes, candidate.aoiTypecodePrefixes || []);
  const matchedAoiTexts = uniqText([]
    .concat(collectKeywordMatches(evidence.aoiTexts, candidate.aoiKeywords || []))
    .concat(collectKeywordMatches(evidence.aoiTexts, candidate.aoiAliasKeywords || [])), 4);
  const matchedBusinessAreas = collectKeywordMatches(evidence.businessAreaTexts, candidate.businessAreaKeywords || []);
  if (matchedNativeCategoryCodes.length) {
    score += 3;
    reasons.push('命中高德分类编码');
  }
  if (matchedNativeCategoryTexts.length) {
    score += 2;
    reasons.push('命中高德分类文本');
  }
  if (matchedContextTexts.length) {
    score += 1;
    reasons.push('命中地点语义');
  }
  if (matchedPoiTypes.length) {
    score += 3;
    reasons.push('命中POI类型');
  }
  if (matchedPoiTypecodes.length) {
    score += 3;
    reasons.push('命中POI分类编码');
  }
  if (matchedPoiNames.length) {
    score += 4;
    reasons.push('命中POI名称');
  }
  if (matchedAoiTypecodes.length) {
    score += 3;
    reasons.push('命中AOI类型编码');
  }
  if (matchedAoiTexts.length) {
    score += 3;
    reasons.push('命中AOI');
  }
  if (matchedBusinessAreas.length) {
    score += 1;
    reasons.push('命中商圈');
  }
  if (Array.isArray(candidate.timePhases) && candidate.timePhases.includes(evidence.timePhase)) {
    score += 1;
    reasons.push('命中时间段');
  }
  if (Array.isArray(candidate.seasons) && candidate.seasons.includes(evidence.season)) {
    score += 1;
    reasons.push('命中季节');
  }
  if (Array.isArray(candidate.weathers) && candidate.weathers.includes(evidence.weather)) {
    score += 1;
    reasons.push('命中天气');
  }
  const hardAnchorLayer = calculateLayerScore([
    { matches: matchedPoiNames, base: 4, extra: 0.5, extraCap: 2, cap: 5, reason: '命中POI名称' },
    { matches: matchedAoiTexts, base: 4, extra: 0.5, extraCap: 2, cap: 5, reason: '命中AOI' },
  ], 8);
  const structuralLayer = calculateLayerScore([
    { matches: matchedPoiTypecodes, base: 2.5, extra: 0.5, extraCap: 2, cap: 3.5, reason: '命中POI分类编码' },
    { matches: matchedAoiTypecodes, base: 2.5, extra: 0.5, extraCap: 2, cap: 3.5, reason: '命中AOI类型编码' },
    { matches: matchedNativeCategoryCodes, base: 1.5, extra: 0.5, extraCap: 1, cap: 2, reason: '命中高德分类编码' },
    { matches: matchedPoiTypes, base: 1.5, extra: 0.5, extraCap: 2, cap: 2.5, reason: '命中POI类型' },
    { matches: matchedNativeCategoryTexts, base: 1, extra: 0.25, extraCap: 2, cap: 1.5, reason: '命中高德分类文本' },
  ], 6);
  const semanticLayer = calculateLayerScore([
    { matches: matchedContextTexts, base: 0.75, extra: 0.25, extraCap: 2, cap: 1.25, reason: '命中地点语义' },
    { matches: matchedBusinessAreas, base: 0.75, extra: 0.25, extraCap: 1, cap: 1, reason: '命中商圈' },
  ], 2);
  const timeLayer = calculateLayerScore([
    { matches: Array.isArray(candidate.timePhases) && candidate.timePhases.includes(evidence.timePhase) ? [evidence.timePhase] : [], base: 0.75, reason: '命中时间段' },
    { matches: Array.isArray(candidate.seasons) && candidate.seasons.includes(evidence.season) ? [evidence.season] : [], base: 0.5, reason: '命中季节' },
    { matches: Array.isArray(candidate.weathers) && candidate.weathers.includes(evidence.weather) ? [evidence.weather] : [], base: 0.5, reason: '命中天气' },
  ], 1.75);
  const conflictPenalty = scoreConflictPenalty(candidate, evidence);
  score = Number((
    baseScore
    + hardAnchorLayer.score
    + structuralLayer.score
    + semanticLayer.score
    + timeLayer.score
    - conflictPenalty.penaltyScore
  ).toFixed(2));
  const finalReasons = uniqText([
    ...hardAnchorLayer.reasons,
    ...structuralLayer.reasons,
    ...semanticLayer.reasons,
    ...timeLayer.reasons,
    ...conflictPenalty.penaltyReasons.map((reason) => `冲突扣分:${reason}`),
  ], 12);
  const scoreBreakdown = {
    baseScore,
    hardAnchorScore: hardAnchorLayer.score,
    structuralScore: structuralLayer.score,
    semanticScore: semanticLayer.score,
    timeScore: timeLayer.score,
    penaltyScore: conflictPenalty.penaltyScore,
    finalScore: score,
  };
  const hasSpecificEvidence = hardAnchorLayer.score > 0 || structuralLayer.score >= 2.5;
  const passesHardEvidenceGate = candidate.level !== 'hard-evidence' || hasSpecificEvidence;
  return {
    label: candidate.label,
    level: candidate.level,
    score,
    threshold,
    available: score >= threshold && passesHardEvidenceGate,
    reasons: finalReasons,
    passesHardEvidenceGate,
    matchedNativeCategoryCodes,
    matchedNativeCategoryTexts,
    matchedContextTexts,
    matchedPoiTypes,
    matchedPoiTypecodes,
    matchedPoiNames,
    matchedAoiTypecodes,
    matchedAoiTexts,
    matchedBusinessAreas,
    scoreBreakdown,
    penalties: conflictPenalty.penaltyReasons,
  };
}

function formatPreferenceObjectEvidence(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const parts = [];
  if (item.matchedNativeCategoryTexts && item.matchedNativeCategoryTexts.length) {
    parts.push(`高德类型=${item.matchedNativeCategoryTexts.join('、')}`);
  }
  if (item.matchedAoiTexts && item.matchedAoiTexts.length) {
    parts.push(`AOI=${item.matchedAoiTexts.join('、')}`);
  }
  if (item.matchedContextTexts && item.matchedContextTexts.length) {
    parts.push(`地点语义=${item.matchedContextTexts.join('、')}`);
  }
  if (item.matchedBusinessAreas && item.matchedBusinessAreas.length) {
    parts.push(`商圈=${item.matchedBusinessAreas.join('、')}`);
  }
  if (item.matchedPoiTypes && item.matchedPoiTypes.length) {
    parts.push(`POI类型=${item.matchedPoiTypes.join('、')}`);
  }
  if (item.matchedPoiNames && item.matchedPoiNames.length) {
    parts.push(`POI=${item.matchedPoiNames.join('、')}`);
  }
  return parts.join('；');
}

function buildPreferenceObjectSummary(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const evidenceParts = [];
  if (item.matchedPoiNames && item.matchedPoiNames.length) {
    evidenceParts.push(`附近可对照 ${item.matchedPoiNames.slice(0, 2).join('、')}`);
  }
  if (item.matchedAoiTexts && item.matchedAoiTexts.length) {
    evidenceParts.push(`AOI 更接近 ${item.matchedAoiTexts.slice(0, 2).join('、')}`);
  }
  if (item.matchedBusinessAreas && item.matchedBusinessAreas.length) {
    evidenceParts.push(`商圈线索有 ${item.matchedBusinessAreas.slice(0, 2).join('、')}`);
  }
  if (item.matchedPoiTypes && item.matchedPoiTypes.length) {
    evidenceParts.push(`周边类型像 ${item.matchedPoiTypes.slice(0, 2).join('、')}`);
  }
  if (item.matchedNativeCategoryTexts && item.matchedNativeCategoryTexts.length) {
    evidenceParts.push(`整体语境偏 ${item.matchedNativeCategoryTexts.slice(0, 2).join('、')}`);
  }
  if (item.matchedContextTexts && item.matchedContextTexts.length) {
    evidenceParts.push(`地点提到 ${item.matchedContextTexts.slice(0, 2).join('、')}`);
  }
  return {
    label: item.label,
    level: item.level,
    summary: evidenceParts.slice(0, 3).join('；') || '属于当前场景里更稳妥的可用对象',
  };
}

function chooseTaskPlaceLabel(locationSignals, nearbySummary) {
  const preferred = [
    ...(nearbySummary.poiNames || []),
    nearbySummary.primaryAoiName,
    locationSignals.locationName,
    locationSignals.locationContext,
    locationSignals.sceneTag,
  ].map((item) => String(item || '').trim()).filter(Boolean);
  return preferred.find((item) => (
    item
    && item !== '当前位置'
    && item !== '城市街道'
    && item !== nearbySummary.dominantScene
  )) || '这片地方';
}

function buildPreferenceContext(event) {
  const memo = getRuntimeMemo(event);
  if (memo && memo.preferenceContext) {
    return memo.preferenceContext;
  }
  const preference = normalizePreference(event);
  const nearbySummary = normalizeNearbySummary(event);
  const locationSignals = normalizeLocationSignals(event);
  const timeContext = normalizeTimeContext(event);
  const environment = normalizeEnvironmentContext(event);
  const library = preference && PREFERENCE_OBJECT_LIBRARY[preference]
    ? PREFERENCE_OBJECT_LIBRARY[preference]
    : null;
  if (!library) {
    const emptyResult = {
        preference,
        availableObjects: [],
        blockedObjects: [],
        safeObjects: buildGlobalSafeObjects(event, 12),
        evidenceNotes: [],
      objectDetails: [],
      objectHints: [],
        avoidHints: [],
        instruction: '',
      };
    if (memo) {
      memo.preferenceContext = emptyResult;
    }
    return emptyResult;
  }
  const evidence = {
    nativeCategoryCodes: uniqText([
      nearbySummary.dominantSceneId,
      nearbySummary.primaryAoiTypecode,
      ...nearbySummary.poiTypecodes,
      ...nearbySummary.sceneCandidates.map((item) => item && item.id).filter(Boolean),
    ].filter((item) => isNativeTypecode(item)), 12),
    nativeCategoryTexts: uniqText([
      nearbySummary.dominantScene,
      nearbySummary.primaryAoiType,
      ...nearbySummary.sceneCandidates.map((item) => item && item.label).filter(Boolean),
      ...nearbySummary.poiTypes,
    ], 12),
    contextTexts: uniqText([
      nearbySummary.primaryAoiName,
      ...nearbySummary.aoiNames,
      locationSignals.sceneTag,
      locationSignals.locationContext,
      locationSignals.locationName,
    ], 12),
    poiNames: uniqText(nearbySummary.poiNames || [], 8),
    poiTypes: uniqText(nearbySummary.poiTypes || [], 6),
    poiTypecodes: uniqText(nearbySummary.poiTypecodes || [], 12),
    aoiTypecodes: uniqText(
      []
        .concat(nearbySummary.primaryAoiTypecode || [])
        .concat(nearbySummary.aoiTypecodes || [])
        .filter((item) => isNativeTypecode(item)),
      8
    ),
    aoiTexts: uniqText([nearbySummary.primaryAoiName, nearbySummary.primaryAoiType].concat(nearbySummary.aoiNames || []), 8),
    businessAreaTexts: uniqText(nearbySummary.businessAreaNames || [], 6),
    timePhase: timeContext.timePhase || '',
    season: environment.season,
    weather: environment.weather,
  };
  const scoredObjects = (library.objects || [])
    .map((candidate) => scorePreferenceObjectCandidate(candidate, evidence))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return String(left.label || '').localeCompare(String(right.label || ''), 'zh-Hans-CN');
    });
  const availableCandidates = scoredObjects
    .filter((item) => item.available);
  const preferredAvailableCandidates = availableCandidates
    .slice()
    .sort((left, right) => {
      const levelOrder = {
        'hard-evidence': 3,
        'scene-bound': 2,
        safe: 1,
      };
      const leftOrder = levelOrder[left.level] || 0;
      const rightOrder = levelOrder[right.level] || 0;
      if (rightOrder !== leftOrder) {
        return rightOrder - leftOrder;
      }
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return String(left.label || '').localeCompare(String(right.label || ''), 'zh-Hans-CN');
    });
  const availableObjects = preferredAvailableCandidates
    .map((item) => item.label);
  const blockedObjects = scoredObjects
    .filter((item) => !item.available)
    .map((item) => item.label)
    .slice(0, 6);
  const safeObjects = availableCandidates
    .filter((item) => item.level === 'safe')
    .map((item) => item.label)
    .slice(0, 6);
  const availableDetails = preferredAvailableCandidates
    .slice(0, 6);
  const evidenceNotes = availableDetails
    .slice(0, 4)
    .map((item) => `${item.label}：${formatPreferenceObjectEvidence(item) || item.reasons.join('、') || '基础安全对象'}`);
  const objectDetails = availableDetails
    .slice(0, 3)
    .map((item) => buildPreferenceObjectSummary(item))
    .filter(Boolean);
  const result = {
      preference,
      availableObjects,
      blockedObjects,
      safeObjects,
    evidenceNotes,
    objectDetails,
      objectHints: availableObjects,
      avoidHints: uniqText(library.avoid || [], 5),
      instruction: String(library.instruction || '').trim(),
    };
  if (memo) {
    memo.preferenceContext = result;
  }
  return result;
}

function buildCompactValidationContext(promptContext) {
  const context = promptContext && typeof promptContext === 'object' ? promptContext : {};
  const locationSignals = context.locationSignals && typeof context.locationSignals === 'object'
    ? context.locationSignals
    : {};
  const timeContext = context.timeContext && typeof context.timeContext === 'object'
    ? context.timeContext
    : {};
  const nearbySummary = context.nearbySummary && typeof context.nearbySummary === 'object'
    ? context.nearbySummary
    : {};
  return {
    location: locationSignals.locationName || '',
    sceneTag: locationSignals.sceneTag || locationSignals.locationContext || '',
    timePhase: timeContext.timePhase || '',
    timeHints: uniqText(timeContext.timeHints || [], 3),
    nearbyScene: nearbySummary.dominantScene || '',
    poiNames: uniqText(nearbySummary.poiNames || [], 3),
  };
}

function measureMissionVariety(missions) {
  const normalizedMissions = Array.isArray(missions) ? missions.map((item) => String(item || '')).filter(Boolean) : [];
  if (normalizedMissions.length <= 1) {
    return {
      similarPairCount: 0,
      uniqueSignatureCount: normalizedMissions.length,
      varietyRatio: normalizedMissions.length ? 1 : 0,
    };
  }
  let similarPairCount = 0;
  for (let leftIndex = 0; leftIndex < normalizedMissions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalizedMissions.length; rightIndex += 1) {
      if (missionsAreSimilar(normalizedMissions[leftIndex], normalizedMissions[rightIndex])) {
        similarPairCount += 1;
      }
    }
  }
  const uniqueSignatureCount = new Set(normalizedMissions.map(missionSignature).filter(Boolean)).size;
  return {
    similarPairCount,
    uniqueSignatureCount,
    varietyRatio: Number((uniqueSignatureCount / normalizedMissions.length).toFixed(2)),
  };
}

function summarizeThemeValidation(theme, event, options = {}) {
  const categories = normalizeCategoryList(options.categories || []);
  const missions = Array.isArray(theme && theme.missions) ? theme.missions : [];
  const walkMode = event && event.walkMode === 'advanced' ? 'advanced' : 'pure';
  const modeConfig = VALIDATION_MODE_CONFIG[walkMode] || VALIDATION_MODE_CONFIG.pure;
  const anchorCount = missions.filter((mission) => containsContextAnchor(mission, event)).length;
  const hasAnchor = anchorCount > 0;
  const genericMissionCount = missions.filter((mission) => isMissionTooGeneric(mission)).length;
  const variety = measureMissionVariety(missions);
  const expectedMissionCount = walkMode === 'advanced' ? 3 : 1;
  const insufficientMissionCount = missions.length < expectedMissionCount;
  const lowVariety = missions.length > 1 && (
    variety.similarPairCount > modeConfig.allowSimilarPairs
    || variety.varietyRatio < modeConfig.minVarietyRatio
  );
  const missionCountRatio = Number((Math.min(missions.length, expectedMissionCount) / expectedMissionCount).toFixed(2));
  const genericCleanRatio = missions.length
    ? Number(((missions.length - genericMissionCount) / missions.length).toFixed(2))
    : 0;
  const varietyRatio = missions.length > 1 ? variety.varietyRatio : 1;
  const score = Math.max(0, Math.min(100, Math.round(
    (missionCountRatio * 35)
    + (genericCleanRatio * 35)
    + (varietyRatio * 30)
  )));
  const lowScore = score < modeConfig.minScore;
  const reasons = [];
  if (insufficientMissionCount) {
    reasons.push(walkMode === 'advanced'
      ? '任务条数不足，进阶模式应生成 3 条任务'
      : '任务条数不足，纯粹模式应生成 1 条任务');
  }
  if (genericMissionCount > 0) {
    reasons.push(`仍有 ${genericMissionCount} 条任务过于空泛`);
  }
  if (lowVariety) {
    reasons.push('任务之间差异不够，切入角度仍然偏像');
  }
  if (lowScore) {
    reasons.push(`结构预检 ${score} 分，低于 ${modeConfig.minScore} 分参考线`);
  }
  if (!reasons.length) {
    reasons.push(walkMode === 'advanced'
      ? '结构预检通过，主题命中与是否跑偏交给 AI 复核'
      : '结构预检通过，主题命中与是否跑偏交给 AI 复核');
  }
  const shouldRunSecondaryValidation = !!options.allowSecondaryValidation;
  return {
    stage: 'precheck',
    ok: !insufficientMissionCount
      && genericMissionCount === 0
      && !lowVariety
      && !lowScore,
    walkMode,
    modeConfig,
    categories,
    hasAnchor,
    anchorCount,
    genericMissionCount,
    offThemeMatches: [],
    matchedMissionIndexes: [],
    missingCategories: [],
    varietyRatio,
    similarPairCount: variety.similarPairCount,
    insufficientThemeTrace: false,
    insufficientAnchors: false,
    insufficientMissionCount,
    lowScore,
    score,
    reasons,
    shouldRunSecondaryValidation,
  };
}

function buildSecondaryValidationPrompt(theme, event, options = {}) {
  const promptContext = buildPromptContextBlock(event, options);
  const categories = normalizeCategoryList(options.categories || []);
  const categoryReviewRules = buildCategoryReviewRules(categories);
  const recentHistory = normalizeRecentMissionHistory(event, 6);
  const contextPacket = getContextPacket(event);
  const ragPlan = options.currentPlan && typeof options.currentPlan === 'object'
    ? options.currentPlan
    : contextPacket.rag && contextPacket.rag.plan && typeof contextPacket.rag.plan === 'object'
      ? contextPacket.rag.plan
      : {};
  const planMeta = normalizeValidationPlanMeta(ragPlan);
  const compactContext = buildCompactValidationContext(promptContext);
  return `请校验下面这份城市漫步主题是否真正命中指定方向，并且足够具体、在地、可执行。

生成结果：
${JSON.stringify({
  title: theme.title || '',
  description: theme.description || '',
  category: theme.category || '',
  missions: Array.isArray(theme.missions) ? theme.missions : [],
}, null, 2)}

生成上下文：
${JSON.stringify(compactContext, null, 2)}

要求主题方向：
${categories.length ? categories.join('、') : '未指定，可围绕上下文判断是否具体在地'}

最近几次任务历史：
${JSON.stringify(recentHistory, null, 2)}

本次计划信息（如果有）：
${JSON.stringify(planMeta, null, 2)}

请严格返回 JSON：
{
  "ok": true,
  "score": 0,
  "failedChecks": ["themeHit", "concreteness", "novelty"],
  "failedMissionIndexes": [0],
  "reasons": ["..."],
  "reviewComment": "",
  "rewriteAdvice": "",
  "shouldRewrite": false,
  "abstractMissionIndexes": [],
  "repeatedMissionIndexes": [],
  "rewriteScope": "none",
  "rewrittenTheme": {
    "title": "",
    "description": "",
    "missions": ["..."]
  }
}

判定标准：
1. 任务必须命中主题方向；如果指定了两个方向，整体上必须覆盖它们。
2. 任务不能太空泛，不能只是“找一处细节”“感受一下周围”。
3. 任务要贴合当前上下文与时间段，但不要求必须直接写出地点名、POI 名或明确地点表述。
4. 任务必须短、清楚、能执行。
5. 如果任务把“边界、关系、秩序、气质、氛围、状态、张力”这类抽象词直接当观察对象，请判定为 concreteness 失败。
5.1. 对“形状”主题尤其如此：像“观察边角变化”“看轮廓关系”“看线条变化”这种说法，如果没有落到具体对象和具体特征，也应判定为 concreteness 失败。
6. 如果任务和“最近几次任务历史”在动作、对象组合、句式骨架上明显重复，请判定为 novelty 失败。
7. 只有当内容明显跑偏、过泛、过于抽象、或者和最近历史过于重复时，才把 shouldRewrite 设为 true。
8. 无论是否通过，都必须提供 score、至少 2 条 reasons、reviewComment、rewriteAdvice、failedChecks。
9. 只要 failedChecks 非空，就必须返回 failedMissionIndexes；如果问题落在任务层，必须给出对应任务序号，从 0 开始。
10. 如果 failedChecks 包含 concreteness，abstractMissionIndexes 必须给出对应任务序号；如果 failedChecks 包含 novelty，repeatedMissionIndexes 必须给出对应任务序号。
11. rewriteScope 只能是 "none"、"mission-only"、"title-description"、"full" 之一。
12. rewrittenTheme 只在 shouldRewrite=true 时填写；请尽量局部修补，不要重写成抽象散文，也不要复用最近历史里的句式。
13. 如果主题是“形状”，rewrittenTheme 应优先改成具体可观察对象与特征，例如门洞是方是圆、栏杆是密是疏、窗框是高是矮、台阶转角是直是弯，而不是“边界关系、轮廓变化、线条变化”。

补充规则：
${categoryReviewRules.map((item, index) => `${index + 1}. ${item}`).join('\n')}`;
}

function buildSecondaryValidationRepairPrompt(theme, event, options = {}) {
  const promptContext = buildPromptContextBlock(event, options);
  const categories = normalizeCategoryList(options.categories || []);
  const categoryReviewRules = buildCategoryReviewRules(categories);
  const recentHistory = normalizeRecentMissionHistory(event, 6);
  const contextPacket = getContextPacket(event);
  const ragPlan = options.currentPlan && typeof options.currentPlan === 'object'
    ? options.currentPlan
    : contextPacket.rag && contextPacket.rag.plan && typeof contextPacket.rag.plan === 'object'
      ? contextPacket.rag.plan
      : {};
  const planMeta = normalizeValidationPlanMeta(ragPlan);
  const compactContext = buildCompactValidationContext(promptContext);
  const previousValidation = options.previousValidation && typeof options.previousValidation === 'object'
    ? options.previousValidation
    : {};
  const missingFields = Array.isArray(options.missingFields)
    ? options.missingFields.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const knownValidationFacts = {
    ok: previousValidation && Object.prototype.hasOwnProperty.call(previousValidation, 'ok')
      ? previousValidation.ok
      : null,
    score: previousValidation && Object.prototype.hasOwnProperty.call(previousValidation, 'score')
      ? previousValidation.score
      : null,
    failedChecks: Array.isArray(previousValidation.failedChecks) ? previousValidation.failedChecks : [],
    failedMissionIndexes: Array.isArray(previousValidation.failedMissionIndexes) ? previousValidation.failedMissionIndexes : [],
    abstractMissionIndexes: Array.isArray(previousValidation.abstractMissionIndexes) ? previousValidation.abstractMissionIndexes : [],
    repeatedMissionIndexes: Array.isArray(previousValidation.repeatedMissionIndexes) ? previousValidation.repeatedMissionIndexes : [],
    shouldRewrite: previousValidation && Object.prototype.hasOwnProperty.call(previousValidation, 'shouldRewrite')
      ? previousValidation.shouldRewrite
      : null,
    rewriteScope: previousValidation && Object.prototype.hasOwnProperty.call(previousValidation, 'rewriteScope')
      ? previousValidation.rewriteScope
      : '',
  };
  return `这是一次“字段补全协议任务”，不是重新评审。你上一轮输出的质检 JSON 缺字段，这一轮只能补齐缺失字段并返回完整 JSON。

当前主题结果：
${JSON.stringify({
  title: theme.title || '',
  description: theme.description || '',
  category: theme.category || '',
  missions: Array.isArray(theme.missions) ? theme.missions : [],
}, null, 2)}

生成上下文：
${JSON.stringify(compactContext, null, 2)}

要求主题方向：
${categories.length ? categories.join('、') : '未指定，可围绕上下文判断是否具体在地'}

最近几次任务历史：
${JSON.stringify(recentHistory, null, 2)}

本次计划信息（如果有）：
${JSON.stringify(planMeta, null, 2)}

上一轮质检结果：
${JSON.stringify(previousValidation, null, 2)}

当前已知判断事实：
${JSON.stringify(knownValidationFacts, null, 2)}

本轮仅允许补齐这些缺失字段：
${JSON.stringify(missingFields, null, 2)}

请严格返回 JSON：
{
  "ok": true,
  "score": 0,
  "failedChecks": [],
  "failedMissionIndexes": [],
  "reasons": ["...", "..."],
  "reviewComment": "",
  "rewriteAdvice": "",
  "shouldRewrite": false,
  "abstractMissionIndexes": [],
  "repeatedMissionIndexes": [],
  "rewriteScope": "none",
  "rewrittenTheme": {
    "title": "",
    "description": "",
    "missions": ["..."]
  }
}

协议规则：
1. 这是补全任务，不是重判任务。除非上一轮结果明显自相矛盾，否则必须保留上一轮的判断方向。
2. 所有字段都必须出现；如果没有失败项，failedChecks、failedMissionIndexes、abstractMissionIndexes、repeatedMissionIndexes 都返回空数组。
3. 只要 failedChecks 非空，failedMissionIndexes 绝不能留空。
4. 如果 failedChecks 包含 concreteness，abstractMissionIndexes 绝不能留空；若无法更细分，直接使用 failedMissionIndexes。
5. 如果 failedChecks 包含 novelty，repeatedMissionIndexes 绝不能留空；若无法更细分，直接使用 failedMissionIndexes。
6. failedMissionIndexes、abstractMissionIndexes、repeatedMissionIndexes 的值必须是任务序号数组，从 0 开始；允许重复引用同一条任务，不要求三组互斥。
7. reasons 至少返回 2 条；reviewComment 和 rewriteAdvice 必须是自然中文短句，不能为空。
8. rewriteScope 只能是 "none"、"mission-only"、"title-description"、"full" 之一。
9. 如果 shouldRewrite=true，必须提供 rewrittenTheme，并尽量局部修补；如果 shouldRewrite=false，rewrittenTheme 返回空对象。
9.1. 如果主题是“形状”，rewrittenTheme 不要写成“边界关系、轮廓变化、线条变化”这类抽象说法，应改成具体对象和具体可见特征，比如方圆、宽窄、高低、尖圆、疏密、整齐或歪斜。
10. 不要输出 markdown，不要输出解释，不要输出字段之外的任何文字。

字段补全优先级：
1. 先沿用上一轮已有字段值。
2. 缺失索引字段时，优先根据 failedChecks 和 failedMissionIndexes 自动补齐。
3. 只有在上一轮缺失且无法从已有字段推断时，才重新判断最少量内容。

补充规则：
${categoryReviewRules.map((item, index) => `${index + 1}. ${item}`).join('\n')}`;
}

function buildThemeRewritePrompt(theme, event, options = {}) {
  const promptContext = buildPromptContextBlock(event, options);
  const categories = normalizeCategoryList(options.categories || []);
  const categoryReviewRules = buildCategoryReviewRules(categories);
  const recentHistory = normalizeRecentMissionHistory(event, 6);
  const compactContext = buildCompactValidationContext(promptContext);
  const aiValidation = options.aiValidation && typeof options.aiValidation === 'object'
    ? options.aiValidation
    : {};
  const suggestedTheme = options.suggestedTheme && typeof options.suggestedTheme === 'object'
    ? options.suggestedTheme
    : {};
  const failedMissionIndexes = Array.isArray(aiValidation.failedMissionIndexes)
    ? aiValidation.failedMissionIndexes
    : [];
  const abstractMissionIndexes = Array.isArray(aiValidation.abstractMissionIndexes)
    ? aiValidation.abstractMissionIndexes
    : [];
  const repeatedMissionIndexes = Array.isArray(aiValidation.repeatedMissionIndexes)
    ? aiValidation.repeatedMissionIndexes
    : [];
  return `你是遛遛小程序的主题改写助手。请根据 review 失败原因，重写下面这份城市漫步主题，让它变得更具体、更贴题、更不重复。

当前主题：
${JSON.stringify({
  title: theme.title || '',
  description: theme.description || '',
  category: theme.category || '',
  missions: Array.isArray(theme.missions) ? theme.missions : [],
}, null, 2)}

生成上下文：
${JSON.stringify(compactContext, null, 2)}

要求主题方向：
${categories.length ? categories.join('、') : '未指定'}

最近几次任务历史：
${JSON.stringify(recentHistory, null, 2)}

review 失败结果：
${JSON.stringify({
  failedChecks: Array.isArray(aiValidation.failedChecks) ? aiValidation.failedChecks : [],
  failedMissionIndexes,
  abstractMissionIndexes,
  repeatedMissionIndexes,
  reasons: Array.isArray(aiValidation.reasons) ? aiValidation.reasons : [],
  reviewComment: String(aiValidation.reviewComment || '').trim(),
  rewriteAdvice: String(aiValidation.rewriteAdvice || '').trim(),
  rewriteScope: String(aiValidation.rewriteScope || '').trim(),
}, null, 2)}

review 给出的建议改写（只能当参考，不能机械复述）：
${JSON.stringify({
  title: suggestedTheme.title || '',
  description: suggestedTheme.description || '',
  missions: Array.isArray(suggestedTheme.missions) ? suggestedTheme.missions : [],
}, null, 2)}

请只返回 JSON：
{
  "title": "",
  "description": "",
  "missions": ["..."]
}

改写规则：
1. 必须优先修复 review 指出的失败项，不要只做同义替换。
2. 如果 failedMissionIndexes 非空，必须优先重写这些任务；不要继续沿用这些任务里的核心表达。
3. 如果 abstractMissionIndexes 非空，改写后不能再把“边界、关系、秩序、气质、氛围、状态、张力、变化”这类抽象词直接当观察对象。
4. 如果 repeatedMissionIndexes 非空，改写后任务动作骨架必须和最近历史明显不同。
5. 任务要落到具体对象或具体可观察特征上，比如门洞、栏杆、窗框、台阶、转角、影子、招牌、脚步、气味来源，而不是抽象概念。
6. 不要求必须写地点名，但任务必须一看就知道“去看什么、怎么做”。
7. 语言要短、直接、像真实任务，不要散文，不要解释，不要说教。
8. 不要输出“数清、数一数、数出、统计、几个、多少、编号”这类动作，除非主题方向本身是“数字”。
9. title 和 description 也要同步收紧到主题本身，不要保留原来跑偏的抽象表述。
10. 如果主题是“形状”，优先把任务改写为观察具体特征，例如“看门洞是方是圆”“比较栏杆是密是疏”“找窗框是高是矮”“看台阶转角是直是弯”，不要再写“边界关系、轮廓变化、线条变化、外形变化”。
11. 只能返回 JSON，不要输出额外说明。

补充规则：
${categoryReviewRules.map((item, index) => `${index + 1}. ${item}`).join('\n')}`;
}

function getBaseTaskSkeletons(combined) {
  return combined
    ? [
        '找交集：先找到一个同时能带出两个主题的对象、位置或瞬间',
        '分两层看：先抓第一个主题，再补看第二个主题怎么叠上来',
        '顺着线索走：顺着一个主题的线索往前走，看看它什么时候带出另一个主题',
        '联想：以其中一个主题为基础，看看如何联想到另一个主题',
      ]
    : [
      ];
}

function getSingleThemeSkeletonMap() {
  return {
    形状: [
      '看方圆：先找一个最容易说出是方是圆的对象',
      '看直弯：找栏杆、屋檐、路沿或墙边，看它更像直线还是弧线',
      '看尖圆：找一个尖角或圆角最明显的位置',
      '看轮廓：退后一点，看门洞、窗框、招牌边框或屋檐外形',
      '看框口：找门洞、窗框、栏杆格这类带框的形状',
      '找重复：找一组重复出现的形',
    ],
    色彩: [
      '找一组颜色：先找到最能代表此刻的一组颜色搭配',
      '找最显眼的一块：抓最先注意到的色块',
      '看明暗：站定不动，只看亮处和暗处怎样分开',
      '看材质色：比较同一种颜色落在不同材质上有什么差别',
      '找反差：找一处颜色反差最大的地方',
      '留意边上的颜色：别看主体，专看边缘、角落或背景色',
    ],
    声音: [
      '停一下听：先停下来，只抓离你最近的一层声音',
      '分辨来源：分清一个声音到底从哪里来',
      '顺着声音走几步：跟着一条声音线索移动一小段',
      '等下一次出现：等同一种声音再出现一次',
      '找停留声：找一种会让人驻足的声音',
      '找节奏变化：听某段路上声音什么时候突然变密或变稀',
    ],
    数字: [
      '找顺序：找一组有前后顺序的数字或编号',
      '找变体：找一个不是阿拉伯写法的数字，比如英文数字，罗马数字，汉字数字',
      '找重复数字：找一个重复出现的数字模式',
      '数一数：视野中同类物体有几个',
      '数字指令：数字作为行动指令，比如门牌号决定步数',
    ],
    气味: [
      '闻到后找来源：先确认一股味道，再找它从哪里来',
      '等风过来：先停一会，闻风中伴随的味道是怎么样的',
      '比较前后变化：比较同一条路上前后两处气味差异',
      '找最容易停下的一处：找一处会让你因为味道停一下的地方',
      '找变化点：往前走几步，判断味道在哪一小段突然变浓或变淡',
      '找残留味：找一种人走了、东西收了但味道还在的线索',
    ],
  };
}

function buildTimeWeatherSkeletons(timePhase, weather) {
  const phase = String(timePhase || '').trim();
  const weatherLabel = String(weather || '').trim();
  const map = {
    凌晨: {
      default: [
        '看谁还在：找还在继续工作的线索，看它如何维持这片地方的运转',
        '看空出来的地方：留意白天被遮住的空隙、路口或边角现在怎样显出来',
      ],
      晴朗: [
        '看谁还在：找还在继续工作的线索，看它如何维持这片地方的运转',
        '看空出来的地方：留意白天被遮住的空隙、路口或边角现在怎样显出来',
      ],
      多云: [
        '看谁还在：找还在继续工作的线索，看它如何维持这片地方的运转',
        '看空出来的地方：留意白天被遮住的空隙、路口或边角现在怎样显出来',
      ],
      雨天: [
        '看谁在躲雨也在继续：找一边避雨一边维持运转的线索',
        '找潮湿留下的动作：看雨把哪些停留、经过的痕迹留了下来',
      ],
      大风: [
        '找还稳得住的地方：看哪些动作在风里依旧持续，没有被吹散',
        '看空处怎么发声：留意开阔处、拐角或缝隙怎样把风带出来',
      ],
    },
    清晨: {
      default: [
        '看哪里先醒：找最先开始运转的线索，看这片地方怎样从静转动',
        '看第一波经过：留意最早出现的一批动作',
      ],
      晴朗: [
        '看哪里先醒：找最先开始运转的线索，看这片地方怎样从静转动',
        '找刚被照见的地方：看晨光先把哪些细节或位置提出来',
      ],
      多云: [
        '看哪里先醒：找最先开始运转的线索，看这片地方怎样从静转动',
        '找还带着夜里痕迹的地方：看清晨里还留有哪些夜里的状态',
      ],
      雨天: [
        '看谁冒雨开场：找在潮湿里仍最先开始的一类动作',
        '看避雨怎么改变路线：留意人和动作怎样绕开、贴近或借住遮挡',
      ],
      大风: [
        '看哪里先醒：找最先开始运转的线索，看这片地方怎样从静转动',
        '看风把什么先带出来：留意哪些轻的、松的、悬着的东西最先被提醒',
      ],
    },
    上午: {
      default: [
        '看秩序怎么铺开：找这片地方进入稳定运转后的线索',
        '找最像白天样子的地方：看哪些位置最早显出完整的日间节奏',
      ],
      晴朗: [
        '看秩序怎么铺开：找这片地方进入稳定运转后的线索',
        '找最像白天样子的地方：看哪些位置最早显出完整的日间节奏',
      ],
      多云: [
        '找最像白天样子的地方：看哪些位置最早显出完整的日间节奏',
        '看哪里开始变得耐看：找在柔光里更容易被留意的线索',
      ],
      雨天: [
        '看谁在雨里照常办事：找不因下雨就停掉的动作线索',
        '看避雨怎么改变路线：留意人和动作怎样绕开、贴近或借住遮挡',
      ],
      大风: [
        '看秩序怎么铺开：找这片地方进入稳定运转后的线索',
        '看轻东西怎么暴露现场：观察风把哪些平时不显眼的细节带出来',
      ],
    },
    午后: {
      default: [
        '看谁在躲亮和找阴：找会因为晒、热、亮而改变停留的线索',
        '找慢下来的地方：留意午后节奏怎样从赶路变成短暂停一停',
      ],
      晴朗: [
        '看谁在躲亮和找阴：找会因为晒、热、亮而改变停留的线索',
        '找慢下来的地方：留意午后节奏怎样从赶路变成短暂停一停',
      ],
      多云: [
        '找慢下来的地方：留意午后节奏怎样从赶路变成短暂停一停',
        '看光变软后什么更明显：观察原本硬的节奏怎样被放松一点',
      ],
      雨天: [
        '找慢下来的地方：留意午后节奏怎样从赶路变成短暂停一停',
        '看避雨怎么改变路线：留意人和动作怎样绕开、贴近或借住遮挡',
      ],
      大风: [
        '找慢下来的地方：留意午后节奏怎样从赶路变成短暂停一停',
        '看轻东西怎么暴露现场：观察风把哪些平时不显眼的细节带出来',
      ],
    },
    黄昏: {
      default: [
        '找慢慢灯亮起来的地方：看哪些位置开始从白天节奏转向夜里的停留',
        '看回程怎么和停留叠在一起：留意经过、等人、回程怎样混在一起',
      ],
      晴朗: [
        '找慢慢灯亮起来的地方：看哪些位置开始从白天节奏转向夜里的停留',
        '看回程怎么和停留叠在一起：留意经过、等人、回程怎样混在一起',
      ],
      多云: [
        '找慢慢灯亮起来的地方：看哪些位置开始从白天节奏转向夜里的停留',
        '看回程怎么和停留叠在一起：留意经过、等人、回程怎样混在一起',
      ],
      雨天: [
        '看谁在雨里接住黄昏：找下班、回程、买吃的这些动作怎样被雨重新排布',
        '看水痕怎么把黄昏放大：观察雨后的亮面和反光怎样接管视线',
      ],
      大风: [
        '找慢慢灯亮起来的地方：看哪些位置开始从白天节奏转向夜里的停留',
        '看回程怎么和停留叠在一起：留意经过、等人、回程怎样混在一起',
      ],
    },
    夜间: {
      default: [
        '找亮着但不喧闹的地方：留意夜里真正持续运转的点位',
        '看近处怎么接管注意力：观察夜里哪些细节会比白天更先被看到',
      ],
      晴朗: [
        '找亮着但不喧闹的地方：留意夜里真正持续运转的点位',
        '看近处怎么接管注意力：观察夜里哪些细节会比白天更先被看到',
      ],
      多云: [
        '找亮着但不喧闹的地方：留意夜里真正持续运转的点位',
        '看什么被压低、什么被托出来：观察夜里不同线索怎样重新分层',
      ],
      雨天: [
        '看谁在雨夜里最稳：找即使潮湿、反光、路滑还在持续的线索',
        '看反光怎么改写现场：观察雨夜里地面、窗面、亮面怎样重新组织空间',
      ],
      大风: [
        '看近处怎么接管注意力：观察夜里哪些细节会比白天更先被看到',
        '找风把什么放大了：留意哪些轻微声响、摆动、开合在夜里更显眼',
      ],
    },
  };
  const phaseMap = map[phase] || {};
  const weatherSpecific = phaseMap[weatherLabel] || [];
  const fallback = phaseMap.default || [];
  return uniqText([].concat(weatherSpecific, fallback), 4);
}

function selectThemeSkeletonCandidates(categories, { combined = false } = {}) {
  const normalizedCategories = normalizeCategoryList(categories);
  const baseSkeletons = getBaseTaskSkeletons(combined);
  const singleThemeSkeletonMap = getSingleThemeSkeletonMap();
  if (combined) {
    return [...baseSkeletons];
  }
  return [...(singleThemeSkeletonMap[normalizedCategories[0]] || baseSkeletons)];
}

function buildTaskSkeletonGroups(categories, timePhase, walkMode, options = {}) {
  const normalizedCategories = normalizeCategoryList(categories);
  const combined = !!options.combined;
  const seed = getGenerationSeed(options.event || {});
  const recentHistory = normalizeRecentMissionHistory(options.event || {}, 8);
  const weather = normalizeEnvironmentContext(options.event || {}).weather;
  const timeSkeletons = [];
  const themeSkeletons = selectThemeSkeletonCandidates(normalizedCategories, { combined });
  timeSkeletons.push(...buildTimeWeatherSkeletons(timePhase, weather));
  const orderedThemeBase = rotateBySeed(
    uniqText(themeSkeletons, 12),
    seed,
    `theme-skeleton:${normalizedCategories.join('|')}:${combined ? 'combined' : 'single'}`
  );
  const orderedTheme = !combined && normalizedCategories.length === 1
    ? prioritizeSingleThemeSkeletons(orderedThemeBase, recentHistory)
    : orderedThemeBase;
  const orderedTime = rotateBySeed(
    uniqText(timeSkeletons, 6),
    seed,
    `time-skeleton:${timePhase}:${weather}:${normalizedCategories.join('|')}`
  );
  return {
    themeSkeletons: orderedTheme,
    timeSkeletons: orderedTime,
  };
}

function buildPromptContextBlock(event, options = {}) {
  const memo = getRuntimeMemo(event);
  const memoKey = memo
    ? `promptContext:${normalizeCategoryList(options.categories || []).join('|')}:${options.walkMode || event.walkMode}:${options.combined ? 'combined' : 'single'}`
    : '';
  if (memo && memo[memoKey]) {
    return memo[memoKey];
  }
  const locationSignals = normalizeLocationSignals(event);
  const timeContext = normalizeTimeContext(event);
  const nearbySummary = normalizeNearbySummary(event);
  const preferenceContext = buildPreferenceContext(event);
  const skeletonGroups = buildTaskSkeletonGroups(
    options.categories || [],
    timeContext.timePhase,
    options.walkMode || event.walkMode,
    { combined: !!options.combined, event }
  );
  const lines = [
    `地点是${locationSignals.locationName || event.locationName || '当前位置'}，当前属于${timeContext.timePhase || '此刻'}。`,
    `附近语境以${nearbySummary.primaryAoiName || nearbySummary.primaryAoiType || nearbySummary.dominantScene || '周边场景'}为主。`,
    preferenceContext.preference
      ? `这次偏好更靠近“${preferenceContext.preference}”，优先从可用偏好对象里选观察对象。`
      : '这次没有额外偏好，优先从当下更稳妥、近处、可立刻找到的对象入手。',
    '任务要短、真、可执行，像真实的人会收到的观察指令。',
  ];
  const result = {
      locationSignals,
      timeContext,
      nearbySummary,
      preferenceContext,
      skeletonHints: uniqText([].concat(skeletonGroups.themeSkeletons, skeletonGroups.timeSkeletons), 24),
      themeSkeletonHints: skeletonGroups.themeSkeletons,
      timeSkeletonHints: skeletonGroups.timeSkeletons,
      text: lines.join('\n'),
    };
  if (memo) {
    memo[memoKey] = result;
  }
  return result;
}

function buildPreparedRuntimeContext(event, options = {}) {
  const promptContext = buildPromptContextBlock(event, options);
  return {
    locationSignals: promptContext.locationSignals,
    timeContext: promptContext.timeContext,
    nearbySummary: promptContext.nearbySummary,
    preferenceContext: promptContext.preferenceContext,
    promptContext,
    recentMissionHistory: normalizeRecentMissionHistory(event, options.recentHistoryLimit || 10),
  };
}

function buildAnchoredMission(event, options = {}) {
  const timeContext = normalizeTimeContext(event);
  const nearbySummary = normalizeNearbySummary(event);
  const locationSignals = normalizeLocationSignals(event);
  const preferenceContext = buildPreferenceContext(event);
  const scene = chooseTaskPlaceLabel(locationSignals, nearbySummary);
  const nearbyAnchor = nearbySummary.poiNames[0] || '';
  const focusPool = []
    .concat(timeContext.timeHints || [])
    .concat(nearbySummary.poiNames || [])
    .concat(preferenceContext.objectHints || [])
    .filter(Boolean);
  const focus = focusPool.length ? focusPool[Math.floor(Math.random() * Math.min(focusPool.length, 4))] : '';
  const preferredObject = preferenceContext.objectHints.length
    ? preferenceContext.objectHints[Math.floor(Math.random() * Math.min(preferenceContext.objectHints.length, 5))]
    : '';
  const timeLabel = timeContext.timePhase || '此刻';
  const categories = normalizeCategoryList(options.categories || []);
  const subject = options.combined && categories.length
    ? `同时带出${categories.join('和')}`
    : categories.length
      ? `最能带出${categories[0]}感`
      : '最能带出此刻感受';
  const anchorTemplates = nearbyAnchor
    ? [
        `先把目光落在${nearbyAnchor}${preferredObject ? `旁边的${preferredObject}` : '附近'}，找一处${subject}的细节`,
        `从${nearbyAnchor}开始看，留意一处${subject}的${preferredObject || '地方'}`,
        `把${nearbyAnchor}当入口，找一处${subject}的${preferredObject || '细节'}`,
      ]
    : [];
  const templates = focus
    ? [
        `在${scene}先看${preferredObject || focus}，找一处${subject}的细节`,
        `${timeLabel}里先在${scene}停一下，看看哪一处${preferredObject || focus} ${subject}`.replace(/\s+/g, ''),
        `沿着${scene}慢慢走，找到一处${preferredObject || focus}，留意它怎样带出${subject}`,
        `别急着经过${scene}，先盯住${preferredObject || focus}，找一处${subject}的细节`,
        `绕着${scene}看一圈，找一处${preferredObject || focus}，留意${focus}`,
        `在${scene}先慢半步，看看哪一处${preferredObject || focus}最先把${subject}带出来`,
        `${timeLabel}的${scene}里，找一处${preferredObject || focus}，看它怎么把${subject}带出来`,
        nearbyAnchor ? `从${nearbyAnchor}往外看，先看${preferredObject || focus}，找一处${subject}的细节` : '',
      ]
    : [
        `在${scene}${preferredObject ? `先看${preferredObject}，` : ''}找一处${subject}的细节`,
        `${timeLabel}里先在${scene}停一下，${preferredObject ? `看${preferredObject}` : `找一处${subject}的细节`}`,
        `沿着${scene}慢慢走，${preferredObject ? `找到一处${preferredObject}` : `找到一处${subject}的细节`}`,
        `别急着穿过${scene}，先找一处${preferredObject || subject}`,
        `${timeLabel}的${scene}里，找一处最能代表此刻的${preferredObject || subject}细节`,
        `${scene}里先选一个停下来的点，再看${preferredObject || `一处${subject}的细节`}`,
      ];
  const basePool = uniqText([].concat(anchorTemplates, templates).filter(Boolean), 16);
  const seed = getGenerationSeed(event);
  const missionSlot = Number.isInteger(options.missionSlot) ? options.missionSlot : 0;
  const poolIndex = basePool.length
    ? Math.floor(hashStringToUnit(`${seed}|anchored|${missionSlot}|${scene}|${subject}`) * basePool.length) % basePool.length
    : 0;
  const base = basePool[poolIndex] || basePool[0] || `在${scene}留意一处${subject}的细节`;
  return compactMission(base, options.walkMode || event.walkMode);
}

function containsContextAnchor(text, event) {
  const mission = String(text || '');
  const timeContext = normalizeTimeContext(event);
  const nearbySummary = normalizeNearbySummary(event);
  const keywords = [
    timeContext.timePhase,
    ...timeContext.timeHints,
    nearbySummary.dominantScene,
    ...nearbySummary.poiNames,
  ].filter(Boolean);
  return keywords.some((keyword) => keyword && mission.includes(keyword));
}

function finalizeTheme(theme, event, fallbackTheme, options = {}) {
  const walkMode = options.walkMode || event.walkMode;
  const missionCount = walkMode === 'advanced' ? 3 : 1;
  const fallbackMissions = Array.isArray(fallbackTheme.missions) ? fallbackTheme.missions : [];
  const categories = normalizeCategoryList(options.categories || []);
  const preferAnchoredFill = !!options.preferAnchoredFill;
  const recentHistory = normalizeRecentMissionHistory(event, 10);
  const recentMissions = recentHistory.map((item) => item.mission).filter(Boolean);
  const inputMissions = (Array.isArray(theme.missions) ? theme.missions : [])
    .map((mission) => compactMission(mission, walkMode))
    .filter(Boolean)
    .slice(0, missionCount);
  const candidateMissionEntries = []
    .concat((Array.isArray(theme.missions) ? theme.missions : []).map((mission, index) => ({
      mission,
      missionIndex: index,
      source: 'theme',
    })))
    .concat(fallbackMissions.map((mission, index) => ({
      mission,
      missionIndex: index,
      source: 'fallback',
    })));
  const missions = [];
  const changeLog = [];
  candidateMissionEntries.forEach((entry) => {
    if (missions.length >= missionCount) {
      return;
    }
    const mission = compactMission(entry.mission, walkMode);
    if (!mission) {
      return;
    }
    if (containsDisallowedMissionAction(mission, categories)) {
      if (entry.source === 'theme') {
        changeLog.push({
          type: 'drop_disallowed_action',
          missionIndex: entry.missionIndex,
          before: mission,
          after: '',
          reason: '任务动作偏成数字统计或编号识别，已从候选结果中移除',
        });
      }
      return;
    }
    if (isRecentMissionRepeat(mission, recentMissions)) {
      if (entry.source === 'theme') {
        changeLog.push({
          type: 'drop_recent_repeat',
          missionIndex: entry.missionIndex,
          before: mission,
          after: '',
          reason: '任务和最近几次生成过于相似，已从候选结果中移除',
        });
      }
      return;
    }
    if (!missions.some((existing) => missionsAreSimilar(existing, mission))) {
      missions.push(mission);
    }
  });
  while (missions.length < missionCount) {
    const insertIndex = missions.length;
    const fallbackMission = compactMission(fallbackMissions[insertIndex] || '', walkMode);
    const anchoredCandidates = [0, 1, 2]
      .map((offset) => buildAnchoredMission(event, {
        ...options,
        missionSlot: insertIndex + (offset * missionCount),
      }))
      .filter(Boolean);
    const candidatePool = preferAnchoredFill
      ? [].concat(anchoredCandidates, fallbackMission)
      : [].concat(fallbackMission, anchoredCandidates);
    const selectedMission = candidatePool.find((candidate) => (
      candidate
      && !missions.some((existing) => missionsAreSimilar(existing, candidate))
      && !isRecentMissionRepeat(candidate, recentMissions)
    ));
    if (!selectedMission) {
      break;
    }
    missions.push(selectedMission);
    changeLog.push({
      type: 'fill_missing_mission',
      missionIndex: insertIndex,
      before: '',
      after: selectedMission,
      reason: anchoredCandidates.includes(selectedMission)
        ? '原始结果任务数不足，优先补入 anchored mission'
        : '原始结果任务数不足，补入 fallback mission',
    });
  }

  const finalMissions = missions.slice(0, missionCount);
  const rewritten = changeLog.length > 0
    || finalMissions.some((mission, index) => mission !== (inputMissions[index] || ''));
  const anchoredCount = changeLog.filter((item) => /anchor/.test(item.type) || /anchored mission/.test(item.reason)).length;
  const fallbackCount = changeLog.filter((item) => /fallback/.test(item.type) || /fallback mission/.test(item.reason)).length;

  return {
    ...theme,
    title: clampText(theme.title || fallbackTheme.title, 12) || fallbackTheme.title,
    description: clampText(theme.description || fallbackTheme.description, 32) || fallbackTheme.description,
    missions: finalMissions,
    finalization: {
      stage: 'finalizeTheme',
      rewritten,
      replacementCount: changeLog.length,
      anchoredReplacementCount: anchoredCount,
      fallbackReplacementCount: fallbackCount,
      changedMissionIndexes: uniqText(changeLog.map((item) => String(item.missionIndex)), 8).map((item) => Number(item)),
      reasons: uniqText(changeLog.map((item) => item.reason), 8),
      changeLog: changeLog.slice(0, 8),
      beforeMissions: inputMissions,
      afterMissions: finalMissions,
    },
  };
}

module.exports = {
  getContextPacket,
  normalizeLocationSignals,
  normalizeTimeContext,
  summarizeCoreTimeHints,
  normalizePreference,
  normalizeNearbySummary,
  normalizeRecentMissionHistory,
  normalizeCategoryList,
  buildPreferenceContext,
  buildTaskSkeletonGroups,
  buildPreparedRuntimeContext,
  buildPromptContextBlock,
  cleanText,
  clampText,
  compactMission,
  inferMissionActionType,
  missionsAreSimilar,
  summarizeThemeValidation,
  buildSecondaryValidationPrompt,
  buildSecondaryValidationRepairPrompt,
  buildThemeRewritePrompt,
  chooseTaskPlaceLabel,
  buildAnchoredMission,
  containsContextAnchor,
  finalizeTheme,
};

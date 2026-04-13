// Auto-generated from cloudfunctions/shared/generation-runtime.js
function getGenerationContext(event) {
  return event && event.generationContext && typeof event.generationContext === 'object'
    ? event.generationContext
    : {};
}

function getContextPacket(event) {
  const generationContext = getGenerationContext(event);
  return generationContext.contextPacket && typeof generationContext.contextPacket === 'object'
    ? generationContext.contextPacket
    : {};
}

function normalizeLocationSignals(event) {
  const contextPacket = getContextPacket(event);
  const locationPacket = contextPacket.location && typeof contextPacket.location === 'object'
    ? contextPacket.location
    : {};
  return {
    locationName: event.locationName || locationPacket.name || '',
    locationContext: event.locationContext || event.sceneTag || event.placeName || locationPacket.sceneTag || '',
    sceneTag: event.sceneTag || event.locationContext || locationPacket.sceneTag || '',
  };
}

function normalizeTimeContext(event) {
  const contextPacket = getContextPacket(event);
  const packetTime = contextPacket.time && typeof contextPacket.time === 'object' ? contextPacket.time : {};
  const generationContext = getGenerationContext(event);
  const timeContext = event && event.timeContext && typeof event.timeContext === 'object'
    ? event.timeContext
    : generationContext.timeContext && typeof generationContext.timeContext === 'object'
      ? generationContext.timeContext
      : packetTime;
  return {
    localTime: typeof timeContext.localTime === 'string' ? timeContext.localTime : '',
    hour: Number.isFinite(Number(timeContext.hour)) ? Number(timeContext.hour) : null,
    timePhase: typeof timeContext.timePhase === 'string' ? timeContext.timePhase : '',
    weekdayType: typeof timeContext.weekdayType === 'string' ? timeContext.weekdayType : '',
    timeHints: Array.isArray(timeContext.timeHints)
      ? timeContext.timeHints.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : [],
  };
}

function normalizeNearbySummary(event) {
  const contextPacket = getContextPacket(event);
  const packetNearby = contextPacket.nearby && typeof contextPacket.nearby === 'object' ? contextPacket.nearby : {};
  const generationContext = getGenerationContext(event);
  const nearbySummary = event && event.nearbySummary && typeof event.nearbySummary === 'object'
    ? event.nearbySummary
    : generationContext.nearbySummary && typeof generationContext.nearbySummary === 'object'
      ? generationContext.nearbySummary
      : packetNearby;
  return {
    poiNames: Array.isArray(nearbySummary.poiNames)
      ? nearbySummary.poiNames.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
      : [],
    poiTypes: Array.isArray(nearbySummary.poiTypes)
      ? nearbySummary.poiTypes.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
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
    activityHints: Array.isArray(nearbySummary.activityHints)
      ? nearbySummary.activityHints.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 5)
      : [],
  };
}

function normalizeRecentMissionHistory(event, limit = 10) {
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
  return result.slice(0, limit);
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
  const maxLength = walkMode === 'advanced' ? 28 : 36;
  const cleaned = cleanText(text);
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  const clauses = cleaned.split(/[，。；;！!]/).map((item) => item.trim()).filter(Boolean);
  if (!clauses.length) {
    return clampText(cleaned, maxLength);
  }
  let result = clauses[0];
  if (clauses[1] && result.length < maxLength - 8) {
    result = `${result}，${clauses[1]}`;
  }
  return clampText(result, maxLength);
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
    activityHints: uniqText(nearbySummary.activityHints || [], 2),
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

function buildTaskSkeletonHints(categories, timePhase, walkMode, options = {}) {
  const normalizedCategories = normalizeCategoryList(categories);
  const combined = !!options.combined;
  const suppressThemeSpecificSkeletons = !combined && normalizedCategories.length === 1;
  const seed = getGenerationSeed(options.event || {});
  const recentHistory = normalizeRecentMissionHistory(options.event || {}, 8);
  const sharedSkeletons = combined
    ? [
        '寻找：先找到一个同时呼应多个方向的对象或位置',
        '比较：比较同一方向在两处位置上的差异',
        '停留：在同一处多停20到30秒，看它如何变化',
        '回头看：走过以后再回头看一次，判断前后感受有什么变化',
        '换个位置：换一个站位或高度，再看两个方向怎样重新叠在一起',
        '先猜再确认：先做一个判断，再去找现场证据支持或推翻它',
        '倒推原因：先从结果感受出发，再往回想它为什么会在这里成立',
      ]
    : [
        '寻找：先找到一个明确对象或位置',
        '比较：比较两处细节的差异',
        '停留：在同一处多停20到30秒',
        '回头看：走过以后再回头看一次，判断哪个细节最留下来',
        '换个位置：换一个站位或高度，再看对象关系是否变化',
        '先猜再确认：先做一个判断，再去找现场证据支持或推翻它',
        '倒推原因：先从一个结果感受出发，再往回想它为什么出现在这里',
        '顺着找：顺着一条线索往前走，看看它会把你带到哪里',
      ];
  const singleThemeSkeletonMap = {
    形状: [
      '找一处：先抓住一个具体结构、边角或轮廓转折',
      '绕着看：围着同一个对象看它的外形怎么变',
      '换个角度：退后或走近，再看线条怎样变化',
      '从远到近：先看整体外形，再贴近看局部',
      '贴近细部：只盯一个边角、接缝或转折',
    ],
    色彩: [
      '找一组颜色：先找到最能代表此刻的一组颜色',
      '比较色差：比较同一对象在两处位置的颜色差异',
      '看颜色怎么变：站定之后看颜色怎样随着位置或光线改变',
      '找最突出的那一块：只抓住最先跳出来的色块',
      '顺着颜色再找下一处：让一种颜色带你走到下一处线索',
    ],
    声音: [
      '停一下听：先停下来，只抓离你最近的一层声音',
      '分辨来源：分清一个声音到底从哪里来',
      '顺着声音走几步：跟着一条声音线索移动一小段',
      '等下一次出现：等同一种声音再出现一次',
      '回头再听：走过以后回头听，判断刚才漏掉了什么',
    ],
    数字: [
      '先猜再确认：先猜一个数字线索的意思，再走近确认',
      '找一个规则：找出一个会影响行动的数字规则',
      '核对两个线索：拿两个数字提示互相核对',
      '判断哪个更像提示：找出最像给人指路的数字信息',
      '找一个会影响行动的数字：抓住一个会让你决定往哪走的数字',
    ],
    气味: [
      '闻到后找来源：先确认一股味道，再找它从哪里来',
      '换个位置再闻：前后挪一步，看气味怎么变',
      '等风过来：先停一会，等味道自己过来',
      '比较前后变化：比较同一条路上前后两处气味差异',
      '找最容易停下的一处：找一处会让你因为味道停一下的地方',
    ],
  };
  const skeletons = suppressThemeSpecificSkeletons
    ? [...(singleThemeSkeletonMap[normalizedCategories[0]] || sharedSkeletons)]
    : [...sharedSkeletons];
  if (timePhase === '黄昏' || timePhase === '夜间') {
    skeletons.push('等待：等一个变化发生，比如亮灯、人流收拢、声音变密');
  }
  if (timePhase === '清晨' || timePhase === '上午') {
    skeletons.push('看开场：抓住刚开始出现的变化，比如开门、上班、第一波停留');
  }
  if (timePhase === '午后') {
    skeletons.push('看人怎么绕：观察人们为了光线、阴影、热度而怎样改变停留和路线');
  }
  if (timePhase === '凌晨') {
    skeletons.push('看谁还在：找还在继续工作的线索，看它如何维持这片地方的运转');
  }
  if (!suppressThemeSpecificSkeletons && (normalizedCategories.includes('声音') || normalizedCategories.includes('气味'))) {
    skeletons.push(combined ? '判断来源：判断声音或气味与另一个方向如何相遇' : '判断来源：判断声音或气味从哪里来');
    skeletons.push(combined ? '跟着扩散走：跟一段声音或气味的扩散路径，看它和另一方向怎样叠在一起' : '跟着扩散走：跟一段声音或气味的扩散路径');
  }
  if (!suppressThemeSpecificSkeletons && normalizedCategories.includes('色彩')) {
    skeletons.push('对照：对照同一元素在不同位置的表现');
    skeletons.push('盯住细部：只看一个边缘、色块或转折，看看它怎样改变整体感觉');
  }
  if (!suppressThemeSpecificSkeletons && normalizedCategories.includes('数字')) {
    skeletons.push('辨认数字：先找数字形状、数量关系、数字变体或行动密码');
    skeletons.push('验证数量：先猜一个数量，再去现场验证是不是对的');
  }
  if (!suppressThemeSpecificSkeletons && normalizedCategories.includes('色彩')) {
    skeletons.push('找反差：先找最跳出的颜色，再看它被什么环境托出来');
  }
  if (!suppressThemeSpecificSkeletons && normalizedCategories.includes('声音')) {
    skeletons.push('分前后听：先分清前景声和背景声，再判断谁在主导你的注意力');
  }
  if (!suppressThemeSpecificSkeletons && normalizedCategories.includes('气味')) {
    skeletons.push('找边界：在气味变强或变弱的地方停一下，判断它从哪里开始变化');
  }
  const orderedBase = rotateBySeed(uniqText(skeletons, 12), seed, `skeleton:${normalizedCategories.join('|')}:${timePhase}:${combined ? 'combined' : 'single'}`);
  const ordered = suppressThemeSpecificSkeletons
    ? prioritizeSingleThemeSkeletons(orderedBase, recentHistory)
    : orderedBase;
  return (walkMode === 'advanced' ? ordered : ordered.slice(0, 4)).slice(0, walkMode === 'advanced' ? 8 : 5);
}

function buildPromptContextBlock(event, options = {}) {
  const locationSignals = normalizeLocationSignals(event);
  const timeContext = normalizeTimeContext(event);
  const nearbySummary = normalizeNearbySummary(event);
  const skeletonHints = buildTaskSkeletonHints(
    options.categories || [],
    timeContext.timePhase,
    options.walkMode || event.walkMode,
    { combined: !!options.combined, event }
  );
  const lines = [
    `地点：${locationSignals.locationName || event.locationName || '当前位置'}`,
    `场景标签：${locationSignals.sceneTag || locationSignals.locationContext || '未提供'}`,
    `当前时间：${timeContext.localTime || '未提供'}`,
    `时间段：${timeContext.timePhase || '未提供'}`,
    `日期类型：${timeContext.weekdayType || '未提供'}`,
    `时间线索：${timeContext.timeHints.length ? timeContext.timeHints.join('、') : '未提供'}`,
    `附近场景：${nearbySummary.dominantScene || '未提供'}`,
    `附近候选场景：${nearbySummary.sceneCandidates.length ? nearbySummary.sceneCandidates.map((item) => item.label || item.id).filter(Boolean).join('、') : '未提供'}`,
    `附近类型：${nearbySummary.poiTypes.length ? nearbySummary.poiTypes.join('、') : '未提供'}`,
    `附近 POI：${nearbySummary.poiNames.length ? nearbySummary.poiNames.join('、') : '未提供'}`,
    `附近活动线索：${nearbySummary.activityHints.length ? nearbySummary.activityHints.join('、') : '未提供'}`,
    `优先任务骨架：${skeletonHints.join('；')}`,
  ];
  return {
    locationSignals,
    timeContext,
    nearbySummary,
    skeletonHints,
    text: lines.join('\n'),
  };
}

function buildAnchoredMission(event, options = {}) {
  const timeContext = normalizeTimeContext(event);
  const nearbySummary = normalizeNearbySummary(event);
  const locationSignals = normalizeLocationSignals(event);
  const scene = nearbySummary.dominantScene || locationSignals.locationContext || locationSignals.locationName || '附近';
  const nearbyAnchor = nearbySummary.poiNames[0] || '';
  const focusPool = []
    .concat(nearbySummary.activityHints || [])
    .concat(timeContext.timeHints || [])
    .concat(nearbySummary.poiNames || [])
    .filter(Boolean);
  const focus = focusPool.length ? focusPool[Math.floor(Math.random() * Math.min(focusPool.length, 4))] : '';
  const timeLabel = timeContext.timePhase || '此刻';
  const categories = normalizeCategoryList(options.categories || []);
  const categorySubjectMap = {
    形状: '贴近形状主题',
    色彩: '贴近色彩主题',
    声音: '贴近声音主题',
    数字: '贴近数字主题',
    气味: '贴近气味主题',
  };
  const subject = options.combined && categories.length
    ? `同时呼应${categories.join('和')}`
    : categories.length
      ? (categorySubjectMap[categories[0]] || `贴近${categories[0]}主题`)
      : '最贴近此刻';
  const anchorTemplates = nearbyAnchor
    ? [
        `先把目光落在${nearbyAnchor}附近，找一处${subject}的细节`,
        `从${nearbyAnchor}开始看，留意一处${subject}的地方`,
        `把${nearbyAnchor}当入口，找一处${subject}的细节`,
      ]
    : [];
  const templates = focus
    ? [
        `在${scene}找一处${subject}的细节，留意${focus}`,
        `${timeLabel}里先在${scene}停一下，找一处${subject}的细节，看看${focus}是怎么出现的`,
        `沿着${scene}慢慢走，找到一处${subject}的地方，注意${focus}`,
        `别急着经过${scene}，找一处${subject}的细节，留意${focus}`,
        `绕着${scene}看一圈，找一处${subject}的细节，留意${focus}`,
        `在${scene}先慢半步，看看哪一处${subject}的地方最先被${focus}带出来`,
        `${timeLabel}的${scene}里，找一处${subject}的细节，判断${focus}为什么会落在这里`,
        nearbyAnchor ? `从${nearbyAnchor}往外看，找一处${subject}的细节，留意${focus}` : '',
      ]
    : [
        `在${scene}找一处${subject}的细节`,
        `${timeLabel}里先在${scene}停一下，找一处${subject}的细节`,
        `沿着${scene}慢慢走，找到一处${subject}的细节`,
        `别急着穿过${scene}，先找一处${subject}的地方`,
        `${timeLabel}的${scene}里，找一处最能代表此刻的${subject}细节`,
        `${scene}里先选一个停下来的点，再找一处${subject}的细节`,
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
    ...nearbySummary.activityHints,
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
  normalizeNearbySummary,
  normalizeRecentMissionHistory,
  normalizeCategoryList,
  buildTaskSkeletonHints,
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
  buildAnchoredMission,
  containsContextAnchor,
  finalizeTheme,
};

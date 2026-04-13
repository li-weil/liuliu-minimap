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

function cleanText(text) {
  return String(text || '').replace(/\s+/g, '').replace(/[。！!；;]+$/g, '').trim();
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

function normalizeCategoryList(categories) {
  return (Array.isArray(categories) ? categories : [categories])
    .map((item) => String(item || '').replace(/漫步/g, '').trim())
    .filter(Boolean);
}

const CATEGORY_SIGNAL_PATTERNS = {
  形状: /形状|轮廓|线条|弧|圆角|几何|对称|边角|门洞|窗框|框住|边界|拱|曲线/,
  色彩: /颜色|色彩|色块|撞色|渐变|明暗|反光|光影|暖色|冷色|色温|亮面|阴影|褪色|高光|配色|色阶/,
  声音: /声音|听见|听听|风声|脚步声|脚步|回声|铃声|叫卖|广播|人声|店内音乐|报站|提示音|快门|讲解|交谈|环境声/,
  数字: /数字|数一数|数清|数出|计数|数量|编号|门牌|楼层|几个|几处|几条|几层|几步|几次|几组|几扇|几片|多少|罗马数字|汉字数字|英文数字|倒计时|序号|票号|出口号/,
  气味: /气味|味道|闻|香气|烟火味|草木味|药味|食物香|香味|潮气|消毒水|热气|冷气|泥土味|机油味|雨水味|清洁味|咖啡香|酒气|烤物味/,
};

function shouldIgnoreOffThemeMatch(text, allowedCategory, candidateCategory) {
  const mission = String(text || '');
  if (allowedCategory === '形状' && candidateCategory === '色彩') {
    return textMatchesCategory(mission, '形状') && /(光影|反光|阴影)/.test(mission);
  }
  if (allowedCategory === '数字' && candidateCategory === '形状') {
    return textMatchesCategory(mission, '数字') && /(像数字的.*形状|数字形状|隐形数字|最像几)/.test(mission);
  }
  return false;
}

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

function textMatchesCategory(text, category) {
  const pattern = CATEGORY_SIGNAL_PATTERNS[category];
  if (!pattern) {
    return false;
  }
  return pattern.test(String(text || ''));
}

function countMatchedCategories(text, categories) {
  const normalizedCategories = normalizeCategoryList(categories);
  return normalizedCategories.filter((category) => textMatchesCategory(text, category));
}

function findOffThemeMatches(text, allowedCategories) {
  const allowed = new Set(normalizeCategoryList(allowedCategories || []));
  const singleAllowedCategory = allowed.size === 1 ? Array.from(allowed)[0] : '';
  return Object.keys(CATEGORY_SIGNAL_PATTERNS)
    .filter((category) => !allowed.has(category) && textMatchesCategory(text, category))
    .filter((category) => !shouldIgnoreOffThemeMatch(text, singleAllowedCategory, category));
}

function isMissionTooGeneric(text) {
  const mission = cleanText(text);
  if (!mission) {
    return true;
  }
  return /找一处让你停下的细节|最贴近此刻的细节|观察一下周围|看看附近有什么|感受一下这里|寻找一个细节/.test(mission);
}

function validateThemeHit(theme, options = {}) {
  const categories = normalizeCategoryList(options.categories || []);
  const combined = !!options.combined;
  const missions = Array.isArray(theme && theme.missions) ? theme.missions.map((item) => String(item || '')) : [];
  const summary = {
    ok: true,
    matchedMissionIndexes: [],
    missingCategories: [],
    genericMissionIndexes: [],
    offThemeMatches: [],
  };

  missions.forEach((mission, index) => {
    if (isMissionTooGeneric(mission)) {
      summary.genericMissionIndexes.push(index);
    }
  });

  if (!categories.length) {
    summary.ok = missions.some((mission) => !isMissionTooGeneric(mission));
    return summary;
  }

  if (combined && categories.length > 1) {
    const covered = new Set();
    missions.forEach((mission, index) => {
      const matched = countMatchedCategories(mission, categories);
      if (matched.length) {
        summary.matchedMissionIndexes.push(index);
        matched.forEach((category) => covered.add(category));
      }
    });
    summary.missingCategories = categories.filter((category) => !covered.has(category));
    summary.ok = !summary.missingCategories.length;
    return summary;
  }

  const targetCategory = categories[0];
  missions.forEach((mission, index) => {
    if (textMatchesCategory(mission, targetCategory)) {
      summary.matchedMissionIndexes.push(index);
    }
    const offThemeCategories = findOffThemeMatches(mission, [targetCategory]);
    offThemeCategories.forEach((category) => {
      summary.offThemeMatches.push({
        missionIndex: index,
        category,
      });
    });
  });
  summary.missingCategories = summary.matchedMissionIndexes.length ? [] : [targetCategory];
  summary.ok = summary.matchedMissionIndexes.length > 0 && !summary.offThemeMatches.length;
  return summary;
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
  const ruleValidation = validateThemeHit(theme, options);
  const anchorCount = missions.filter((mission) => containsContextAnchor(mission, event)).length;
  const hasAnchor = anchorCount > 0;
  const genericMissionCount = missions.filter((mission) => isMissionTooGeneric(mission)).length;
  const variety = measureMissionVariety(missions);
  const expectedThemeHits = categories.length
    ? Math.min(modeConfig.minThemeHits, missions.length || modeConfig.minThemeHits)
    : 0;
  const insufficientThemeTrace = expectedThemeHits > 0 && ruleValidation.matchedMissionIndexes.length < expectedThemeHits;
  const expectedAnchorCount = Math.min(modeConfig.minAnchors, missions.length || modeConfig.minAnchors);
  const insufficientAnchors = anchorCount < expectedAnchorCount;
  const lowVariety = missions.length > 1 && (
    variety.similarPairCount > modeConfig.allowSimilarPairs
    || variety.varietyRatio < modeConfig.minVarietyRatio
  );
  const missingCategoryCount = ruleValidation.missingCategories.length;
  const offThemeCount = Array.isArray(ruleValidation.offThemeMatches) ? ruleValidation.offThemeMatches.length : 0;
  const categoryCoverageRatio = categories.length
    ? Number(((categories.length - missingCategoryCount) / categories.length).toFixed(2))
    : 1;
  const themeTraceRatio = expectedThemeHits > 0
    ? Number((Math.min(ruleValidation.matchedMissionIndexes.length, expectedThemeHits) / expectedThemeHits).toFixed(2))
    : (ruleValidation.ok ? 1 : 0);
  const anchorCoverageRatio = expectedAnchorCount > 0
    ? Number((Math.min(anchorCount, expectedAnchorCount) / expectedAnchorCount).toFixed(2))
    : (hasAnchor ? 1 : 0);
  const genericCleanRatio = missions.length
    ? Number(((missions.length - genericMissionCount) / missions.length).toFixed(2))
    : 0;
  const varietyRatio = missions.length > 1 ? variety.varietyRatio : 1;
  const score = Math.max(0, Math.min(100, Math.round(
    (categoryCoverageRatio * 30)
    + (themeTraceRatio * 20)
    + (anchorCoverageRatio * 20)
    + (Math.max(0, genericCleanRatio - offThemeCount * 0.25) * 15)
    + (varietyRatio * 15)
  )));
  const lowScore = score < modeConfig.minScore;
  const reasons = [];
  if (!ruleValidation.ok && ruleValidation.missingCategories.length) {
    reasons.push(`缺少主题命中：${ruleValidation.missingCategories.join('、')}`);
  }
  if (insufficientThemeTrace && categories.length) {
    reasons.push(walkMode === 'advanced'
      ? `命中主题的任务条数不够，进阶模式至少要有 ${expectedThemeHits} 条任务能看出主题痕迹`
      : '唯一任务没有稳定命中主题');
  }
  if (insufficientAnchors) {
    reasons.push(walkMode === 'advanced'
      ? `在地锚点覆盖不够，进阶模式至少 ${expectedAnchorCount} 条任务应带地点或时间线索`
      : '缺少足够明确的在地锚点');
  }
  if (genericMissionCount > 0) {
    reasons.push(`仍有 ${genericMissionCount} 条任务过于空泛`);
  }
  if (offThemeCount > 0 && categories.length === 1) {
    const offThemeCategories = normalizeCategoryList(ruleValidation.offThemeMatches.map((item) => item.category));
    reasons.push(`单主题任务混入了未选方向：${offThemeCategories.join('、')}`);
  }
  if (lowVariety) {
    reasons.push('任务之间差异不够，切入角度仍然偏像');
  }
  if (lowScore) {
    reasons.push(`规则评分 ${score} 分，低于 ${modeConfig.minScore} 分通过线`);
  }
  if (!reasons.length) {
    reasons.push(walkMode === 'advanced'
      ? '主题命中、在地锚点和任务差异度都通过规则校验'
      : '主题命中和在地锚点通过规则校验');
  }
  const shouldRunSecondaryValidation = !!(
    options.allowSecondaryValidation
    && (
      !ruleValidation.ok
      || insufficientAnchors
      || genericMissionCount > 0
      || offThemeCount > 0
      || insufficientThemeTrace
      || lowVariety
      || lowScore
      || (walkMode === 'pure' && categories.length && !ruleValidation.matchedMissionIndexes.length)
    )
  );
  return {
    stage: 'rule',
    ok: ruleValidation.ok
      && genericMissionCount === 0
      && offThemeCount === 0
      && !insufficientAnchors
      && !insufficientThemeTrace
      && !lowVariety
      && !lowScore,
    walkMode,
    modeConfig,
    categories,
    hasAnchor,
    anchorCount,
    genericMissionCount,
    offThemeMatches: ruleValidation.offThemeMatches,
    matchedMissionIndexes: ruleValidation.matchedMissionIndexes,
    missingCategories: ruleValidation.missingCategories,
    varietyRatio,
    similarPairCount: variety.similarPairCount,
    insufficientThemeTrace,
    insufficientAnchors,
    lowScore,
    score,
    reasons,
    shouldRunSecondaryValidation,
  };
}

function buildSecondaryValidationPrompt(theme, event, options = {}) {
  const promptContext = buildPromptContextBlock(event, options);
  const categories = normalizeCategoryList(options.categories || []);
  return `请校验下面这份城市漫步主题是否真正命中指定方向，并且足够具体、在地、可执行。

生成结果：
${JSON.stringify({
  title: theme.title || '',
  description: theme.description || '',
  category: theme.category || '',
  missions: Array.isArray(theme.missions) ? theme.missions : [],
}, null, 2)}

生成上下文：
${promptContext.text}

要求主题方向：
${categories.length ? categories.join('、') : '未指定，可围绕上下文判断是否具体在地'}

请严格返回 JSON：
{
  "ok": true,
  "score": 0,
  "reasons": ["..."],
  "shouldRewrite": false,
  "rewrittenTheme": {
    "title": "",
    "description": "",
    "missions": ["..."]
  }
}

判定标准：
1. 任务必须命中主题方向；如果指定了两个方向，整体上必须覆盖它们。
2. 任务不能太空泛，不能只是“找一处细节”“感受一下周围”。
3. 任务必须像这个地点、这个时间段才会成立，而不是放哪里都一样。
4. 任务必须短、清楚、能执行。
5. 只有当内容明显跑偏、过泛、或者完全不够在地时，才把 shouldRewrite 设为 true。
6. rewrittenTheme 只在 shouldRewrite=true 时填写；请尽量局部修补，不要重写成抽象散文。`;
}

function buildTaskSkeletonHints(categories, timePhase, walkMode, options = {}) {
  const normalizedCategories = normalizeCategoryList(categories);
  const combined = !!options.combined;
  const skeletons = combined
    ? [
        '寻找：先找到一个同时呼应多个方向的对象或位置',
        '比较：比较同一方向在两处位置上的差异',
        '停留：在同一处多停20到30秒，看它如何变化',
      ]
    : [
        '寻找：先找到一个明确对象或位置',
        '比较：比较两处细节的差异',
        '停留：在同一处多停20到30秒',
      ];
  if (timePhase === '黄昏' || timePhase === '夜间') {
    skeletons.push('等待：等一个变化发生，比如亮灯、人流收拢、声音变密');
  }
  if (normalizedCategories.includes('声音') || normalizedCategories.includes('气味')) {
    skeletons.push(combined ? '判断来源：判断声音或气味与另一个方向如何相遇' : '判断来源：判断声音或气味从哪里来');
  }
  if (normalizedCategories.includes('形状') || normalizedCategories.includes('色彩')) {
    skeletons.push('对照：对照同一元素在不同位置的表现');
  }
  if (normalizedCategories.includes('数字')) {
    skeletons.push('辨认数字：先找数字形状、数量关系、数字变体或行动密码');
  }
  return (walkMode === 'advanced' ? skeletons : skeletons.slice(0, 3)).slice(0, 5);
}

function buildPromptContextBlock(event, options = {}) {
  const locationSignals = normalizeLocationSignals(event);
  const timeContext = normalizeTimeContext(event);
  const nearbySummary = normalizeNearbySummary(event);
  const skeletonHints = buildTaskSkeletonHints(
    options.categories || [],
    timeContext.timePhase,
    options.walkMode || event.walkMode,
    { combined: !!options.combined }
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
  const focusPool = []
    .concat(nearbySummary.activityHints || [])
    .concat(timeContext.timeHints || [])
    .concat(nearbySummary.poiNames || [])
    .filter(Boolean);
  const focus = focusPool.length ? focusPool[Math.floor(Math.random() * Math.min(focusPool.length, 4))] : '';
  const timeLabel = timeContext.timePhase || '此刻';
  const categories = normalizeCategoryList(options.categories || []);
  const categorySubjectMap = {
    形状: '带轮廓、边界或弧度',
    色彩: '带色块、明暗或反光',
    声音: '带声音来源或节奏',
    数字: '带编号、数量或数字形状',
    气味: '带气味来源或扩散',
  };
  const subject = options.combined && categories.length
    ? `同时呼应${categories.join('和')}`
    : categories.length
      ? (categorySubjectMap[categories[0]] || `贴近${categories[0]}主题`)
      : '最贴近此刻';
  const templates = focus
    ? [
        `在${scene}找一处${subject}的细节，留意${focus}`,
        `${timeLabel}里先在${scene}停一下，找一处${subject}的细节，看看${focus}是怎么出现的`,
        `沿着${scene}慢慢走，找到一处${subject}的地方，注意${focus}`,
        `别急着经过${scene}，找一处${subject}的细节，留意${focus}`,
      ]
    : [
        `在${scene}找一处${subject}的细节`,
        `${timeLabel}里先在${scene}停一下，找一处${subject}的细节`,
        `沿着${scene}慢慢走，找到一处${subject}的细节`,
      ];
  const base = templates[Math.floor(Math.random() * templates.length)];
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
  const candidateMissions = []
    .concat(Array.isArray(theme.missions) ? theme.missions : [])
    .concat(fallbackMissions)
    .map((mission) => compactMission(mission, walkMode))
    .filter(Boolean);
  const missions = [];
  candidateMissions.forEach((mission) => {
    if (missions.length >= missionCount) {
      return;
    }
    if (!missions.some((existing) => missionsAreSimilar(existing, mission))) {
      missions.push(mission);
    }
  });
  while (missions.length < missionCount) {
    const anchoredMission = buildAnchoredMission(event, options);
    if (!missions.some((existing) => missionsAreSimilar(existing, anchoredMission))) {
      missions.push(anchoredMission);
    } else {
      missions.push(compactMission(fallbackMissions[missions.length] || '找一处让你停下的细节', walkMode));
    }
  }

  let validation = validateThemeHit({ missions }, { categories, combined: options.combined });
  if (!validation.ok && fallbackMissions.length) {
    fallbackMissions
      .map((mission) => compactMission(mission, walkMode))
      .filter(Boolean)
      .forEach((mission) => {
        if (!validation.ok) {
          const offThemeIndexes = (Array.isArray(validation.offThemeMatches) ? validation.offThemeMatches : [])
            .map((item) => item && item.missionIndex)
            .filter((index) => Number.isInteger(index));
          const replaceIndex = missions.findIndex((item, index) => (
            validation.genericMissionIndexes.includes(index)
            || offThemeIndexes.includes(index)
            || !countMatchedCategories(item, categories).length
          ));
          if (replaceIndex >= 0) {
            missions[replaceIndex] = mission;
            validation = validateThemeHit({ missions }, { categories, combined: options.combined });
          }
        }
      });
  }

  const hasAnchor = missions.some((mission) => containsContextAnchor(mission, event));
  if (!hasAnchor) {
    const targetIndex = walkMode === 'pure'
      ? 0
      : missions.findIndex((mission, index) => validation.genericMissionIndexes.includes(index) || isMissionTooGeneric(mission));
    if (targetIndex >= 0) {
      missions[targetIndex] = buildAnchoredMission(event, options);
    }
  }

  return {
    ...theme,
    title: clampText(theme.title || fallbackTheme.title, 12) || fallbackTheme.title,
    description: clampText(theme.description || fallbackTheme.description, 32) || fallbackTheme.description,
    missions: missions.slice(0, missionCount),
  };
}

module.exports = {
  getContextPacket,
  normalizeLocationSignals,
  normalizeTimeContext,
  normalizeNearbySummary,
  normalizeCategoryList,
  buildTaskSkeletonHints,
  buildPromptContextBlock,
  cleanText,
  clampText,
  compactMission,
  missionsAreSimilar,
  validateThemeHit,
  summarizeThemeValidation,
  buildSecondaryValidationPrompt,
  buildAnchoredMission,
  containsContextAnchor,
  finalizeTheme,
};

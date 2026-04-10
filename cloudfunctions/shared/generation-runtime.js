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
      ? timeContext.timeHints.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
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
    dominantScene: typeof nearbySummary.dominantScene === 'string' ? nearbySummary.dominantScene : '',
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
  const focus = nearbySummary.activityHints[0] || timeContext.timeHints[0] || '';
  const timeLabel = timeContext.timePhase || '此刻';
  const categories = normalizeCategoryList(options.categories || []);
  const subject = options.combined && categories.length
    ? `同时呼应${categories.join('和')}`
    : '最贴近此刻';
  const base = focus
    ? `在${scene}找一处${subject}的细节，留意${focus}`
    : `在${scene}找一处${subject}的细节`;
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
  if (!missions.some((mission) => containsContextAnchor(mission, event))) {
    missions[0] = buildAnchoredMission(event, options);
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
  buildAnchoredMission,
  containsContextAnchor,
  finalizeTheme,
};

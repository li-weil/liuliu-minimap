const {
  normalizeLocationSignals,
  normalizeTimeContext,
  normalizeNearbySummary,
  normalizeCategoryList,
} = require('./runtime');

function shuffle(list) {
  const copied = Array.isArray(list) ? [...list] : [];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copied[index], copied[swapIndex]] = [copied[swapIndex], copied[index]];
  }
  return copied;
}

function dedupeStrings(values, limit = 8) {
  const result = [];
  (Array.isArray(values) ? values : []).forEach((item) => {
    const text = String(item || '').trim();
    if (text && !result.includes(text) && result.length < limit) {
      result.push(text);
    }
  });
  return result;
}

function tokenize(parts) {
  return (Array.isArray(parts) ? parts : [parts])
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .split(/[\s,，。；;、/|]+/)
    .filter(Boolean);
}

function getGenerationSeed(event) {
  const generationContext = event && event.generationContext && typeof event.generationContext === 'object'
    ? event.generationContext
    : {};
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

function seededJitter(seed, key, amplitude = 1) {
  if (!seed) {
    return 0;
  }
  return (hashStringToUnit(`${seed}|${key}`) - 0.5) * 2 * amplitude;
}

function rotateBySeed(values, seed) {
  const source = Array.isArray(values) ? values.filter(Boolean) : [];
  if (source.length <= 1 || !seed) {
    return source;
  }
  const offset = Math.floor(hashStringToUnit(seed) * source.length) % source.length;
  return source.slice(offset).concat(source.slice(0, offset));
}

function deriveThemeCategories(missionTemplates, explicitCategories) {
  const directCategories = normalizeCategoryList(explicitCategories || []);
  if (directCategories.length) {
    return directCategories;
  }
  return normalizeCategoryList(
    (Array.isArray(missionTemplates) ? missionTemplates : [])
      .map((template) => template && template.category)
      .filter(Boolean)
  );
}

function normalizeSelectedThemes(selectedThemes, event) {
  const directThemes = normalizeCategoryList(selectedThemes || []);
  if (directThemes.length) {
    return directThemes;
  }
  const generationContext = event && event.generationContext && typeof event.generationContext === 'object'
    ? event.generationContext
    : {};
  const contextPacket = generationContext.contextPacket && typeof generationContext.contextPacket === 'object'
    ? generationContext.contextPacket
    : {};
  const packetThemes = contextPacket.userState && Array.isArray(contextPacket.userState.selectedThemes)
    ? contextPacket.userState.selectedThemes
    : [];
  return normalizeCategoryList(packetThemes);
}

function normalizeStringArray(values, limit = 8) {
  return dedupeStrings(Array.isArray(values) ? values : [values], limit);
}

const THEME_HINT_PATTERNS = {
  形状: /形状|轮廓|线条|弧|圆角|几何|对称|边角|门洞|窗框|框住|边界|拱|曲线|转角|栏杆|护栏|方向线|水波|岸线/,
  色彩: /颜色|色彩|色块|撞色|渐变|明暗|反光|光影|暖色|冷色|色温|亮面|阴影|褪色|高光|材质|灯箱|霓虹|配色|色阶/,
  声音: /声音|听见|听听|风声|脚步声|脚步|回声|铃声|叫卖|广播|人声|店内音乐|报站|提示音|快门|讲解|交谈|锅铲声|环境声/,
  数字: /数字|数一数|数清|数出|计数|数量|编号|门牌|楼层|几个|几处|几条|几层|几步|几次|几组|几扇|几片|多少|罗马数字|汉字数字|英文数字|倒计时|序号|票号|出口号|楼栋号|价签|取号|排队号|叫号|桌号|营业时间/,
  气味: /气味|味道|闻|香气|烟火味|草木味|药味|食物香|香味|潮气|消毒水|热气|旧木头|纸墨味|咖啡香|泥土味|机油味|雨水味|油味|酒气|烤物味|清洁味|冷气/,
};

function classifyHintCategories(text) {
  const hint = String(text || '');
  return Object.keys(THEME_HINT_PATTERNS).filter((category) => THEME_HINT_PATTERNS[category].test(hint));
}

function filterSceneHintsForCategories(hints, categories) {
  const allowedCategories = normalizeCategoryList(categories || []);
  const sourceHints = dedupeStrings(hints || [], 8);
  if (!allowedCategories.length || allowedCategories.length >= 3) {
    return sourceHints;
  }
  const allowed = new Set(allowedCategories);
  const exactMatches = sourceHints.filter((hint) => {
    const matchedCategories = classifyHintCategories(hint);
    return matchedCategories.some((category) => allowed.has(category))
      && !matchedCategories.some((category) => !allowed.has(category));
  });
  if (exactMatches.length) {
    return exactMatches;
  }
  return sourceHints.filter((hint) => {
    const matchedCategories = classifyHintCategories(hint);
    return !matchedCategories.length || !matchedCategories.some((category) => !allowed.has(category));
  });
}

function normalizeTemplate(template = {}, index = 0) {
  const category = String(template.category || '').trim();
  const angles = normalizeStringArray(template.angles || template.angle || [], 6);
  const angle = String(angles[0] || template.id || `${category || 'theme'}-${index + 1}`).trim();
  const diversityTagsSource = template.diversityTags || (angles.length ? angles : [angle]);
  const samples = dedupeStrings(template.templates || template.samples || [], 6);
  const cues = dedupeStrings(template.cues || template.anchorHints || [], 8);
  return {
    id: String(template.id || angle || `template-${index + 1}`),
    category,
    angle,
    angles,
    cues,
    samples,
    sceneFit: normalizeStringArray(template.sceneFit || template.sceneFits || [], 6),
    timeFit: normalizeStringArray(template.timeFit || template.timeFits || [], 6),
    anchorTypes: normalizeStringArray(template.anchorTypes || template.anchorType || [], 6),
    antiPatterns: normalizeStringArray(template.antiPatterns || [], 6),
    diversityTags: normalizeStringArray(diversityTagsSource, 6),
    modes: normalizeStringArray(template.modes || [], 4),
  };
}

function countTokenMatches(keywords, tokens) {
  return (Array.isArray(keywords) ? keywords : []).reduce((total, keyword) => {
    const normalizedKeyword = String(keyword || '').toLowerCase().trim();
    if (!normalizedKeyword) {
      return total;
    }
    return total + (tokens.some((token) => token.includes(normalizedKeyword) || normalizedKeyword.includes(token)) ? 1 : 0);
  }, 0);
}

function scoreScene(scene, context) {
  const keywordHits = countTokenMatches(scene.keywords, context.tokens);
  const sceneText = dedupeStrings([].concat(scene.labels || [], scene.keywords || []), 16).join(' ');
  const categoryHits = normalizeCategoryList(scene.categories || []).filter((category) => context.targetThemes.includes(category)).length;
  const timeFit = normalizeStringArray(scene.timeFit || scene.timeFits || [], 6);
  const timeHit = timeFit.includes(context.timeContext.timePhase) ? 1 : 0;
  const nearbyHit = context.nearbySummary.dominantSceneId && scene.id === context.nearbySummary.dominantSceneId ? 1 : 0;
  const matchedNearbyCandidate = context.nearbySummary.sceneCandidates.find((candidate) => candidate.id && candidate.id === scene.id);
  const candidateHit = matchedNearbyCandidate ? 1 : 0;
  const activityHit = countTokenMatches(scene.missionHints, context.activityTokens) > 0 ? 1 : 0;
  const preferenceHit = (Array.isArray(context.preferenceBias[context.preference]) ? context.preferenceBias[context.preference] : []).includes(scene.id) ? 1 : 0;
  const displayLabel = matchedNearbyCandidate && matchedNearbyCandidate.label
    ? matchedNearbyCandidate.label
    : (nearbyHit && context.nearbySummary.dominantScene ? context.nearbySummary.dominantScene : '');
  const scoreBreakdown = {
    keyword: keywordHits * 3,
    category: categoryHits * 2,
    time: timeHit * 2,
    nearby: nearbyHit * 5 + candidateHit * 2,
    activity: activityHit,
    preference: preferenceHit * 2,
  };
  return {
    id: scene.id || '',
    labels: Array.isArray(scene.labels) ? scene.labels : [],
    displayLabel,
    missionHints: dedupeStrings(scene.missionHints || [], 6),
    categories: normalizeCategoryList(scene.categories || []),
    sceneText,
    timeFit,
    scoreBreakdown,
    score: Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0) + seededJitter(context.seed, `scene:${scene.id}`, 0.6),
  };
}

function scoreTemplate(template, context, usedAngles = []) {
  const categoryMatch = context.targetThemes.includes(template.category) ? 5 : 0;
  const cueMatch = countTokenMatches(template.cues, context.tokens);
  const anchorMatch = countTokenMatches(template.anchorTypes, context.anchorTokens);
  const sceneFitMatch = template.sceneFit.some((item) => context.sceneTokens.includes(item) || context.nearbySceneTokens.includes(item)) ? 1 : 0;
  const timeFitMatch = !template.timeFit.length || template.timeFit.includes(context.timeContext.timePhase) ? 1 : 0;
  const modeFit = !template.modes.length || template.modes.includes(context.walkMode) ? 1 : 0;
  const nearbyCueMatch = countTokenMatches(template.cues, context.nearbyTokens);
  const antiPatternPenalty = template.antiPatterns.some((pattern) => context.targetThemes.includes(pattern)) ? 2 : 0;
  const diversityBonus = usedAngles.includes(template.angle) ? -3 : 2;
  const scoreBreakdown = {
    category: categoryMatch,
    cue: cueMatch * 2,
    anchor: anchorMatch * 2,
    scene: sceneFitMatch * 3,
    time: timeFitMatch * 2,
    mode: modeFit,
    nearby: nearbyCueMatch,
    diversity: diversityBonus,
    penalty: -antiPatternPenalty,
    seed: seededJitter(context.seed, `template:${template.id}`, 0.9),
  };
  return {
    ...template,
    scoreBreakdown,
    score: Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0),
  };
}

function chooseCategories({
  event,
  topScene,
  selectedThemes,
  requestedCategories,
  themeCategories,
}) {
  const preferredSource = Array.isArray(requestedCategories) && requestedCategories.length
    ? requestedCategories
    : selectedThemes;
  const preferredCategories = normalizeCategoryList(preferredSource || []);
  if (preferredCategories.length) {
    return preferredCategories.filter((item) => themeCategories.includes(item)).slice(0, 3);
  }

  const categories = new Set();
  if (event.preference === '自然景观') {
    categories.add('数字');
    categories.add('气味');
    categories.add('声音');
  }
  if (event.preference === '人文历史') {
    categories.add('形状');
    categories.add('数字');
  }
  if (event.preference === '市井烟火') {
    categories.add('色彩');
    categories.add('气味');
  }
  if (event.weather === '雨天') {
    categories.add('声音');
    categories.add('气味');
  }
  if (event.weather === '晴朗') {
    categories.add('色彩');
    categories.add('形状');
  }
  if (event.mood === '怀旧') {
    categories.add('色彩');
    categories.add('形状');
  }
  if (topScene) {
    normalizeCategoryList(topScene.categories || []).forEach((category) => {
      if (themeCategories.includes(category)) {
        categories.add(category);
      }
    });
  }
  return Array.from(categories).slice(0, 3);
}

function selectReferenceMissions(templates, context) {
  const references = [];
  const usedAngles = [];
  const groupedByCategory = context.categories.reduce((result, category) => {
    result[category] = [];
    return result;
  }, {});

  shuffle(templates).forEach((template) => {
    if (template.category && groupedByCategory[template.category]) {
      groupedByCategory[template.category].push(template);
    }
  });

  context.categories.forEach((category) => {
    const ranked = (groupedByCategory[category] || [])
      .map((template) => scoreTemplate(template, context, usedAngles))
      .sort((left, right) => right.score - left.score)
      .slice(0, context.walkMode === 'advanced' ? 3 : 2);

    ranked.forEach((template) => {
      usedAngles.push(template.angle);
      references.push({
        id: template.id,
        category: template.category,
        angle: template.angle,
        cues: template.cues.slice(0, 5),
        samples: template.samples.slice(0, context.walkMode === 'advanced' ? 3 : 2),
        sceneFit: template.sceneFit,
        timeFit: template.timeFit,
        anchorTypes: template.anchorTypes,
        antiPatterns: template.antiPatterns,
        diversityTags: template.diversityTags,
        retrievalScore: template.score,
        scoreBreakdown: template.scoreBreakdown,
      });
    });
  });

  return references.slice(0, context.walkMode === 'advanced' ? 6 : 4);
}

function buildGenerationIntent(event, context) {
  return {
    mustHitThemes: context.categories,
    preferNearbyAnchor: true,
    preferTaskVariety: event.walkMode === 'advanced',
    avoidGeneric: true,
    mode: event.walkMode || 'pure',
    sceneConfidence: context.sceneCandidates.length && context.sceneCandidates[0].score > 0
      ? Math.min(1, Number((context.sceneCandidates[0].score / 18).toFixed(2)))
      : 0,
  };
}

function buildGenerationPlan(context) {
  const leadScene = context.scenes[0] || null;
  const leadReferences = context.referenceMissions.slice(0, 3);
  const recommendedAngles = rotateBySeed(dedupeStrings(leadReferences.map((item) => item.angle), 4), context.seed);
  const primaryAnchors = rotateBySeed(dedupeStrings(
    []
      .concat(context.nearbySummary.poiNames || [])
      .concat(leadReferences.flatMap((item) => item.anchorTypes || []))
      .concat(leadReferences.flatMap((item) => item.cues || [])),
    6
  ), context.seed);
  return {
    targetThemes: context.categories,
    chosenScene: leadScene ? (leadScene.displayLabel || leadScene.labels[0] || leadScene.id) : '',
    sceneId: leadScene ? leadScene.id : '',
    recommendedAngles,
    primaryAnchors,
    antiPatterns: dedupeStrings(leadReferences.flatMap((item) => item.antiPatterns || []), 6),
    supportingScenes: context.scenes.slice(1).map((scene) => scene.displayLabel || scene.labels[0] || scene.id).filter(Boolean),
  };
}

function buildRagDebug(context) {
  return {
    retrievalQuality: context.referenceMissions.length ? 'high' : 'low',
    themeCoverage: context.categories,
    sceneCoverage: context.scenes.map((scene) => ({
      id: scene.id,
      label: scene.displayLabel || scene.labels[0] || scene.id,
      score: scene.retrievalScore,
      scoreBreakdown: scene.scoreBreakdown,
    })),
    anchorCoverage: context.generationPlan.primaryAnchors,
    diversityAngles: context.generationPlan.recommendedAngles,
    antiPatterns: context.generationPlan.antiPatterns,
    selectedReferenceIds: context.referenceMissions.map((item) => item.id),
  };
}

function buildUnifiedRetrievalContext(event, options = {}) {
  const missionTemplates = (Array.isArray(options.missionTemplates) ? options.missionTemplates : []).map(normalizeTemplate);
  const sceneProfiles = Array.isArray(options.sceneProfiles) ? options.sceneProfiles : [];
  const preferenceBias = options.preferenceBias && typeof options.preferenceBias === 'object'
    ? options.preferenceBias
    : {};
  const themeCategories = deriveThemeCategories(missionTemplates, options.themeCategories);
  const selectedThemes = normalizeSelectedThemes(options.selectedThemes || event.selectedThemes, event);
  const requestedCategories = normalizeCategoryList(options.requestedCategories || []);
  const effectiveThemes = requestedCategories.length ? requestedCategories : selectedThemes;
  const timeContext = normalizeTimeContext(event);
  const nearbySummary = normalizeNearbySummary(event);
  const locationSignals = normalizeLocationSignals(event);

  const tokens = tokenize([
    locationSignals.locationName,
    locationSignals.locationContext,
    locationSignals.sceneTag,
    event.preference,
    event.weather,
    event.mood,
    event.season,
    effectiveThemes.join(' '),
    nearbySummary.dominantScene,
    nearbySummary.poiNames.join(' '),
    nearbySummary.poiTypes.join(' '),
    nearbySummary.activityHints.join(' '),
    timeContext.timePhase,
    timeContext.weekdayType,
    timeContext.timeHints.join(' '),
  ]);

  const context = {
    tokens,
    seed: getGenerationSeed(event),
    targetThemes: effectiveThemes.length ? effectiveThemes : themeCategories,
    timeContext,
    nearbySummary,
    walkMode: event.walkMode || 'pure',
    preference: event.preference || '',
    preferenceBias,
    sceneTokens: tokenize([locationSignals.locationContext, locationSignals.sceneTag]),
    nearbySceneTokens: tokenize([
      nearbySummary.dominantScene,
      nearbySummary.sceneCandidates.map((item) => item.label).join(' '),
    ]),
    nearbyTokens: tokenize([
      nearbySummary.poiNames.join(' '),
      nearbySummary.poiTypes.join(' '),
      nearbySummary.activityHints.join(' '),
    ]),
    activityTokens: tokenize(nearbySummary.activityHints),
    anchorTokens: tokenize([nearbySummary.poiNames.join(' '), nearbySummary.poiTypes.join(' ')]),
  };

  const sceneCandidates = sceneProfiles
    .map((scene) => scoreScene(scene, context))
    .sort((left, right) => right.score - left.score);

  const topScenes = sceneCandidates
    .filter((item) => item.score > 0)
    .slice(0, options.maxScenes || 4);

  const fallbackScenes = topScenes.length
    ? topScenes
    : (sceneCandidates.length ? [sceneCandidates[0]] : []);

  const categories = chooseCategories({
    event,
    topScene: fallbackScenes[0],
    selectedThemes: effectiveThemes,
    requestedCategories,
    themeCategories,
  }).slice(0, 3);

  const retrievalContext = {
    ...context,
    categories,
    sceneCandidates,
  };

  const referenceMissions = selectReferenceMissions(missionTemplates, retrievalContext);
  const scenes = fallbackScenes.slice(0, 3).map((scene) => ({
    id: scene.id,
    displayLabel: scene.displayLabel,
    labels: scene.labels,
    missionHints: filterSceneHintsForCategories(scene.missionHints, categories).slice(0, 4),
    categories: scene.categories,
    retrievalScore: scene.score,
    scoreBreakdown: scene.scoreBreakdown,
    timeFit: scene.timeFit,
  }));

  const generationIntent = buildGenerationIntent(event, {
    categories,
    sceneCandidates,
    walkMode: context.walkMode,
  });

  const ragContext = {
    selectedThemes: effectiveThemes,
    requestedCategories,
    locationContext: locationSignals.locationContext,
    sceneTag: locationSignals.sceneTag,
    timeContext,
    nearbySummary,
    scenes,
    categories,
    referenceMissions,
    generationIntent,
  };

  ragContext.generationPlan = buildGenerationPlan(ragContext);
  ragContext.ragDebug = buildRagDebug(ragContext);
  return ragContext;
}

module.exports = {
  buildUnifiedRetrievalContext,
  normalizeSelectedThemes,
};

const cloud = require('wx-server-sdk');
const { chatJson } = require('./ai');
const { retrieveContext, buildFallbackTheme, buildPrompt, buildRagModelInput } = require('./rag');
const {
  finalizeTheme,
  normalizeLocationSignals,
  summarizeThemeValidation,
  buildSecondaryValidationPrompt,
  buildSecondaryValidationRepairPrompt,
  buildThemeRewritePrompt,
} = require('./runtime');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const includeDebugContext = process.env.DEBUG_RAG_CONTEXT === 'true';
const RUNTIME_VERSION = '2026-04-13-single-theme-validation-fallback-r3';
const VALIDATION_LOOP_MAX_PASSES = 2;
const VALIDATION_REPAIR_MAX_ATTEMPTS = 1;

function normalizeGeneratedTitle(title) {
  const text = String(title || '').trim();
  if (!text) {
    return '';
  }
  return text
    .replace(/([A-Za-z\u4e00-\u9fa5])(?:\s*[0-9]{1,2})$/, '$1')
    .replace(/第\s*[0-9]{1,2}\s*版?$/g, '')
    .trim();
}

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
    return mission.text || mission.title || mission.label || mission.mission || mission.name || JSON.stringify(mission);
  }
  return String(mission);
}

function normalizeTheme(theme, walkMode) {
  const missionCount = walkMode === 'advanced' ? 3 : 1;
  const missions = Array.isArray(theme.missions)
    ? theme.missions.map(normalizeMissionText).slice(0, missionCount)
    : [];
  return {
    ...theme,
    title: normalizeGeneratedTitle(theme.title || ''),
    missions: missions.length ? missions : ['寻找一个让你驻足的细节'],
  };
}

function normalizeSelectedThemes(selectedThemes, event) {
  const limit = event && event.walkMode === 'pure' ? 1 : 2;
  return (Array.isArray(selectedThemes) ? selectedThemes : [])
    .map((item) => String(item || '').replace(/漫步/g, '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function isNumberMission(mission) {
  const text = String(mission || '');
  return /数字|数一数|数清|数出|计数|数量|几个|多少|门牌|编号|楼层|步数|密码|罗马数字|汉字数字|英文数字|隐形数字/.test(text)
    || /像(?:数字|[0-9０-９一二三四五六七八九十零两])/.test(text)
    || /(?:凑齐|收集|找到|找出|寻找|记录|拍下|拍到|数清|观察).{0,8}(?:[0-9０-９]+|[一二三四五六七八九十零两])(?:个|片|只|扇|盏|层|步|次|组|处)/.test(text)
    || /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|iv|vi|vii|viii|ix|x)\b/i.test(text);
}

function hasDisallowedCoreActionForTheme(mission, theme) {
  const text = String(mission || '');
  if (!text || theme === '数字') {
    return false;
  }
  return /(?:^|[，。；、\s])(?:数清|数一数|数出|统计)|(?:几个|多少|编号|序号|票号|出口号|楼层|门牌)/.test(text);
}

function isShapeMission(mission) {
  const text = String(mission || '');
  return /形状|轮廓|线条|弧|圆角|几何|对称|拱|边角|门洞|窗框|边界|负空间|方向线|轮廓节奏/.test(text);
}

function isColorMission(mission) {
  const text = String(mission || '');
  return /色|颜色|色彩|红|蓝|黄|绿|渐变|撞色|明暗|色块|反光|光影|色温|亮面|阴影|褪色|高光|配色|色阶/.test(text);
}

function isSoundMission(mission) {
  const text = String(mission || '');
  return /声音|声|听|回响|风声|脚步|铃声|叫卖|环境声|提示音|广播|讲解|快门|交谈/.test(text);
}

function isSmellMission(mission) {
  const text = String(mission || '');
  return /气味|味道|香|臭|闻|潮气|草木味|烟火味|食物香|香味|热气|冷气|泥土味|机油味|雨水味|咖啡香|清洁味|酒气|烤物味/.test(text);
}

const themeRules = {
  形状: {
    matcher: isShapeMission,
    title: (locationName) => `${locationName || '这片街区'}的形状漫步`,
    description: (locationName) => `在 ${locationName || '这片街区'} 里寻找最能体现形状关系与空间变化的细节。`,
    fallbackMissions: [
      '找一处最能体现形状关系的细节',
      '比较两处对象在空间里的摆放差异',
      '记录一个会改变整体感觉的结构变化',
    ],
  },
  色彩: {
    matcher: isColorMission,
    title: (locationName) => `${locationName || '这片街区'}的色彩漫步`,
    description: (locationName) => `在 ${locationName || '这片街区'} 里寻找此刻最有存在感的颜色关系与生活痕迹。`,
    fallbackMissions: [
      '找一处最能代表此刻气质的颜色组合',
      '比较两处颜色在生活环境里的不同作用',
      '记录一种会改变现场感觉的颜色关系',
    ],
  },
  声音: {
    matcher: isSoundMission,
    title: (locationName) => `${locationName || '这片街区'}的声音漫步`,
    description: (locationName) => `把 ${locationName || '这片街区'} 当作今天的声场，留意声音怎样组织行动、停留和关系。`,
    fallbackMissions: [
      '找一个最能说明此刻节奏的声音线索',
      '比较两种声音怎样改变你的停留方式',
      '记录一个会影响人们动作的声音时刻',
    ],
  },
  数字: {
    matcher: isNumberMission,
    title: (locationName) => `${locationName || '这片街区'}的数字漫步`,
    description: (locationName) => `在 ${locationName || '这片街区'} 里寻找数字怎样藏在规则、顺序、判断和行动里。`,
    fallbackMissions: [
      '找一处最像数字线索的现场规则',
      '比较两种数字信息怎样影响你的判断',
      '记录一个只有在这里才成立的数字提示',
    ],
  },
  气味: {
    matcher: isSmellMission,
    title: (locationName) => `${locationName || '这片街区'}的气味漫步`,
    description: (locationName) => `顺着 ${locationName || '这片街区'} 的空气流动，寻找气味怎样和行动、停留、时段连在一起。`,
    fallbackMissions: [
      '找一处最能说明此刻空气状态的气味变化',
      '比较两处气味带来的停留感差异',
      '记录一个会提醒你这里正在发生什么的气味线索',
    ],
  },
};

function forceThemeAlignment(theme, event, fallbackTheme) {
  const selectedThemes = normalizeSelectedThemes(event.selectedThemes);
  if (selectedThemes.length !== 1) {
    return theme;
  }

  const onlyTheme = selectedThemes[0];
  const rule = themeRules[onlyTheme];
  if (!rule) {
    return theme;
  }

  const locationSignals = normalizeLocationSignals(event);
  const currentMissions = Array.isArray(theme.missions) ? theme.missions : [];
  const alignedMissions = currentMissions.filter((mission) => !hasDisallowedCoreActionForTheme(mission, onlyTheme));

  return {
    ...theme,
    category: onlyTheme,
    title: String(theme.title || '').trim() || rule.title(locationSignals.locationName),
    description: String(theme.description || '').trim() || rule.description(locationSignals.locationName),
    missions: alignedMissions.slice(0, event.walkMode === 'advanced' ? 3 : 1),
  };
}

function normalizeAiSuggestedTheme(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const title = String(payload.title || '').trim();
  const description = String(payload.description || '').trim();
  const missions = Array.isArray(payload.missions)
    ? payload.missions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
    : [];
  if (!title && !description && !missions.length) {
    return null;
  }
  return { title, description, missions };
}

function snapshotTheme(theme) {
  const normalizedTheme = theme && typeof theme === 'object' ? theme : {};
  return {
    title: String(normalizedTheme.title || '').trim(),
    description: String(normalizedTheme.description || '').trim(),
    missions: Array.isArray(normalizedTheme.missions)
      ? normalizedTheme.missions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3)
      : [],
  };
}

function cloneJsonSafe(value) {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return null;
  }
}

function summarizePrecheckValidation(validation) {
  const normalizedValidation = validation && typeof validation === 'object' ? validation : {};
  return {
    stage: String(normalizedValidation.stage || '').trim(),
    ok: !!normalizedValidation.ok,
    score: Number.isFinite(Number(normalizedValidation.score))
      ? Number(normalizedValidation.score)
      : null,
    reasons: Array.isArray(normalizedValidation.reasons)
      ? normalizedValidation.reasons.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : [],
    hasAnchor: !!normalizedValidation.hasAnchor,
    anchorCount: Number.isFinite(Number(normalizedValidation.anchorCount))
      ? Number(normalizedValidation.anchorCount)
      : 0,
    genericMissionCount: Number.isFinite(Number(normalizedValidation.genericMissionCount))
      ? Number(normalizedValidation.genericMissionCount)
      : 0,
    varietyRatio: Number.isFinite(Number(normalizedValidation.varietyRatio))
      ? Number(normalizedValidation.varietyRatio)
      : null,
    similarPairCount: Number.isFinite(Number(normalizedValidation.similarPairCount))
      ? Number(normalizedValidation.similarPairCount)
      : 0,
  };
}

function summarizeAiValidationForLoop(aiValidation, rawPayload, missingFields, repairPromptCount, validationComplete) {
  const normalizedValidation = aiValidation && typeof aiValidation === 'object' ? aiValidation : {};
  return {
    stage: 'ai-review',
    ok: normalizedValidation.ok === undefined ? null : !!normalizedValidation.ok,
    score: Number.isFinite(Number(normalizedValidation.score))
      ? Number(normalizedValidation.score)
      : null,
    failedChecks: Array.isArray(normalizedValidation.failedChecks)
      ? normalizedValidation.failedChecks.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : [],
    failedMissionIndexes: Array.isArray(normalizedValidation.failedMissionIndexes)
      ? normalizedValidation.failedMissionIndexes.filter((item) => Number.isInteger(item)).slice(0, 6)
      : [],
    abstractMissionIndexes: Array.isArray(normalizedValidation.abstractMissionIndexes)
      ? normalizedValidation.abstractMissionIndexes.filter((item) => Number.isInteger(item)).slice(0, 6)
      : [],
    repeatedMissionIndexes: Array.isArray(normalizedValidation.repeatedMissionIndexes)
      ? normalizedValidation.repeatedMissionIndexes.filter((item) => Number.isInteger(item)).slice(0, 6)
      : [],
    reasons: Array.isArray(normalizedValidation.reasons)
      ? normalizedValidation.reasons.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : [],
    reviewComment: String(normalizedValidation.reviewComment || '').trim(),
    rewriteAdvice: String(normalizedValidation.rewriteAdvice || '').trim(),
    shouldRewrite: !!normalizedValidation.shouldRewrite,
    rewriteScope: String(normalizedValidation.rewriteScope || '').trim(),
    rewrittenTheme: normalizedValidation.rewrittenTheme
      ? snapshotTheme(normalizedValidation.rewrittenTheme)
      : null,
    fieldPresence: cloneJsonSafe(normalizedValidation.fieldPresence) || {},
    fieldSources: cloneJsonSafe(normalizedValidation.fieldSources) || {},
    validationComplete: !!validationComplete,
    missingFields: Array.isArray(missingFields)
      ? missingFields.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
      : [],
    repairPromptCount: Number(repairPromptCount) || 0,
    raw: cloneJsonSafe(rawPayload) || null,
  };
}

function normalizeAiValidationResult(payload) {
  const normalizedPayload = payload && typeof payload === 'object' ? payload : {};
  const hasScoreField = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(normalizedPayload, 'score');
  const hasFailedChecksField = Array.isArray(normalizedPayload.failedChecks);
  const hasReasonsField = Array.isArray(normalizedPayload.reasons);
  const hasReviewCommentField = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(normalizedPayload, 'reviewComment');
  const hasRewriteAdviceField = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(normalizedPayload, 'rewriteAdvice');
  const hasRewriteScopeField = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(normalizedPayload, 'rewriteScope');
  const hasShouldRewriteField = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(normalizedPayload, 'shouldRewrite');
  const hasOkField = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(normalizedPayload, 'ok');
  const hasFailedMissionIndexesField = Array.isArray(normalizedPayload.failedMissionIndexes);
  const hasAbstractIndexesField = Array.isArray(normalizedPayload.abstractMissionIndexes);
  const hasRepeatedIndexesField = Array.isArray(normalizedPayload.repeatedMissionIndexes);
  const hasRewrittenThemeField = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(normalizedPayload, 'rewrittenTheme');
  const rawReasons = Array.isArray(normalizedPayload.reasons)
    ? normalizedPayload.reasons.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const failedChecks = Array.isArray(normalizedPayload.failedChecks)
    ? normalizedPayload.failedChecks.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const rawFailedMissionIndexes = Array.isArray(normalizedPayload.failedMissionIndexes)
    ? normalizedPayload.failedMissionIndexes.map((item) => Number(item)).filter((item) => Number.isInteger(item)).slice(0, 6)
    : [];
  const rawAbstractMissionIndexes = Array.isArray(normalizedPayload.abstractMissionIndexes)
    ? normalizedPayload.abstractMissionIndexes.map((item) => Number(item)).filter((item) => Number.isInteger(item)).slice(0, 6)
    : [];
  const rawRepeatedMissionIndexes = Array.isArray(normalizedPayload.repeatedMissionIndexes)
    ? normalizedPayload.repeatedMissionIndexes.map((item) => Number(item)).filter((item) => Number.isInteger(item)).slice(0, 6)
    : [];
  const inferredFailedMissionIndexes = []
    .concat(rawFailedMissionIndexes)
    .concat(rawAbstractMissionIndexes)
    .concat(rawRepeatedMissionIndexes)
    .filter((item, index, source) => Number.isInteger(item) && item >= 0 && source.indexOf(item) === index)
    .slice(0, 6);
  const failedMissionIndexes = inferredFailedMissionIndexes;
  const abstractMissionIndexes = rawAbstractMissionIndexes.length
    ? rawAbstractMissionIndexes
    : failedChecks.includes('concreteness')
      ? failedMissionIndexes
      : [];
  const repeatedMissionIndexes = rawRepeatedMissionIndexes.length
    ? rawRepeatedMissionIndexes
    : failedChecks.includes('novelty')
      ? failedMissionIndexes
      : [];
  const ok = normalizedPayload.ok === undefined ? !normalizedPayload.shouldRewrite : !!normalizedPayload.ok;
  const hasScore = Number.isFinite(Number(normalizedPayload.score));
  const score = hasScore
    ? Number(normalizedPayload.score)
    : null;
  const reviewComment = String(normalizedPayload.reviewComment || '').trim();
  const rewriteAdvice = String(normalizedPayload.rewriteAdvice || '').trim();
  const rewriteScope = String(normalizedPayload.rewriteScope || '').trim();
  const rewrittenTheme = normalizeAiSuggestedTheme(normalizedPayload.rewrittenTheme);
  if (!payload || typeof payload !== 'object') {
    return {
      stage: 'ai-review',
      ok,
      score,
      failedChecks,
      reasons: rawReasons,
      reviewComment,
      rewriteAdvice,
      shouldRewrite: false,
      failedMissionIndexes,
      abstractMissionIndexes,
      repeatedMissionIndexes,
      rewriteScope,
      rewrittenTheme,
      fieldPresence: {
        ok: false,
        score: false,
        failedChecks: false,
        reasons: false,
        reviewComment: false,
        rewriteAdvice: false,
        shouldRewrite: false,
        failedMissionIndexes: false,
        abstractMissionIndexes: false,
        repeatedMissionIndexes: false,
        rewriteScope: false,
        rewrittenTheme: false,
      },
      fieldSources: {
        score: 'missing',
        failedChecks: 'missing',
        reasons: 'missing',
        reviewComment: 'missing',
        rewriteAdvice: 'missing',
        rewrittenTheme: 'missing',
      },
    };
  }
  return {
    stage: 'ai-review',
    ok,
    score,
    failedChecks,
    reasons: rawReasons,
    reviewComment,
    rewriteAdvice,
    shouldRewrite: !!normalizedPayload.shouldRewrite,
    failedMissionIndexes,
    abstractMissionIndexes,
    repeatedMissionIndexes,
    rewriteScope,
    rewrittenTheme,
    fieldPresence: {
      ok: hasOkField,
      score: hasScoreField,
      failedChecks: hasFailedChecksField,
      reasons: hasReasonsField,
      reviewComment: hasReviewCommentField,
      rewriteAdvice: hasRewriteAdviceField,
      shouldRewrite: hasShouldRewriteField,
      failedMissionIndexes: hasFailedMissionIndexesField || !!failedMissionIndexes.length,
      abstractMissionIndexes: hasAbstractIndexesField || (failedChecks.includes('concreteness') && !!abstractMissionIndexes.length),
      repeatedMissionIndexes: hasRepeatedIndexesField || (failedChecks.includes('novelty') && !!repeatedMissionIndexes.length),
      rewriteScope: hasRewriteScopeField,
      rewrittenTheme: hasRewrittenThemeField,
    },
    fieldSources: {
      score: hasScoreField && hasScore ? 'ai' : 'missing',
      failedChecks: hasFailedChecksField ? 'ai' : 'missing',
      reasons: hasReasonsField ? 'ai' : 'missing',
      reviewComment: hasReviewCommentField && reviewComment ? 'ai' : 'missing',
      rewriteAdvice: hasRewriteAdviceField && rewriteAdvice ? 'ai' : 'missing',
      rewrittenTheme: hasRewrittenThemeField && rewrittenTheme ? 'ai' : 'missing',
    },
  };
}

function collectIncompleteValidationFields(aiValidation) {
  const validation = aiValidation && typeof aiValidation === 'object' ? aiValidation : {};
  const fieldPresence = validation.fieldPresence && typeof validation.fieldPresence === 'object'
    ? validation.fieldPresence
    : {};
  const missing = [];
  if (!fieldPresence.ok) {
    missing.push('ok');
  }
  if (!fieldPresence.score || validation.score == null) {
    missing.push('score');
  }
  if (!fieldPresence.failedChecks) {
    missing.push('failedChecks');
  }
  if (!fieldPresence.reasons || !Array.isArray(validation.reasons) || validation.reasons.length < 2) {
    missing.push('reasons');
  }
  if (!fieldPresence.reviewComment || !String(validation.reviewComment || '').trim()) {
    missing.push('reviewComment');
  }
  if (!fieldPresence.rewriteAdvice || !String(validation.rewriteAdvice || '').trim()) {
    missing.push('rewriteAdvice');
  }
  if (!fieldPresence.shouldRewrite) {
    missing.push('shouldRewrite');
  }
  if (Array.isArray(validation.failedChecks) && validation.failedChecks.length) {
    const failedMissionIndexes = Array.isArray(validation.failedMissionIndexes) ? validation.failedMissionIndexes : [];
    if (!fieldPresence.failedMissionIndexes || !failedMissionIndexes.length) {
      missing.push('failedMissionIndexes');
    }
  }
  if (!fieldPresence.abstractMissionIndexes) {
    missing.push('abstractMissionIndexes');
  }
  if (!fieldPresence.repeatedMissionIndexes) {
    missing.push('repeatedMissionIndexes');
  }
  if (Array.isArray(validation.failedChecks) && validation.failedChecks.includes('concreteness')) {
    if (!Array.isArray(validation.abstractMissionIndexes) || !validation.abstractMissionIndexes.length) {
      missing.push('abstractMissionIndexes');
    }
  }
  if (Array.isArray(validation.failedChecks) && validation.failedChecks.includes('novelty')) {
    if (!Array.isArray(validation.repeatedMissionIndexes) || !validation.repeatedMissionIndexes.length) {
      missing.push('repeatedMissionIndexes');
    }
  }
  if (!fieldPresence.rewriteScope || !['none', 'mission-only', 'title-description', 'full'].includes(String(validation.rewriteScope || '').trim())) {
    missing.push('rewriteScope');
  }
  if (validation.shouldRewrite && (!fieldPresence.rewrittenTheme || !validation.rewrittenTheme)) {
    missing.push('rewrittenTheme');
  }
  return missing;
}

function collectRepairTargetIndexes(aiValidation) {
  return []
    .concat(Array.isArray(aiValidation && aiValidation.failedMissionIndexes) ? aiValidation.failedMissionIndexes : [])
    .concat(Array.isArray(aiValidation && aiValidation.abstractMissionIndexes) ? aiValidation.abstractMissionIndexes : [])
    .concat(Array.isArray(aiValidation && aiValidation.repeatedMissionIndexes) ? aiValidation.repeatedMissionIndexes : [])
    .filter((item, index, source) => Number.isInteger(item) && item >= 0 && source.indexOf(item) === index);
}

async function requestCompleteAiValidation(theme, event, options) {
  const systemPrompt = '你是遛遛小程序的主题质检助手。只返回合法 JSON，不要输出额外解释。';
  let rawPayload = await chatJson(
    systemPrompt,
    buildSecondaryValidationPrompt(theme, event, options)
  );
  let aiValidation = normalizeAiValidationResult(rawPayload);
  let missingFields = collectIncompleteValidationFields(aiValidation);
  let repairPromptCount = 0;
  const rawResponses = [{
    step: 'review',
    payload: cloneJsonSafe(rawPayload) || null,
    missingFields: missingFields.slice(0, 12),
  }];

  while (missingFields.length && repairPromptCount < VALIDATION_REPAIR_MAX_ATTEMPTS) {
    rawPayload = await chatJson(
      systemPrompt,
      buildSecondaryValidationRepairPrompt(theme, event, {
        ...options,
        previousValidation: rawPayload,
        missingFields,
      })
    );
    aiValidation = normalizeAiValidationResult(rawPayload);
    missingFields = collectIncompleteValidationFields(aiValidation);
    repairPromptCount += 1;
    rawResponses.push({
      step: `repair-${repairPromptCount}`,
      payload: cloneJsonSafe(rawPayload) || null,
      missingFields: missingFields.slice(0, 12),
    });
  }

  return {
    aiValidation,
    rawPayload,
    missingFields,
    repairPromptCount,
    rawResponses,
  };
}

async function requestTargetedRewrite(theme, event, aiValidation, options) {
  const systemPrompt = '你是遛遛小程序的主题改写助手。只返回合法 JSON，不要输出额外解释。';
  const rewritePayload = await chatJson(
    systemPrompt,
    buildThemeRewritePrompt(theme, event, {
      ...options,
      aiValidation,
      suggestedTheme: aiValidation && aiValidation.rewrittenTheme ? aiValidation.rewrittenTheme : null,
    })
  );
  return normalizeTheme(rewritePayload, event.walkMode);
}

function buildValidationResult(precheckValidation, aiValidation, extras = {}) {
  return {
    ...precheckValidation,
    ok: extras.validationComplete ? aiValidation.ok !== false : false,
    stage: 'ai-review',
    precheckScore: precheckValidation.score,
    precheckReasons: precheckValidation.reasons,
    score: aiValidation.score != null ? aiValidation.score : precheckValidation.score,
    reasons: aiValidation.reasons.length ? aiValidation.reasons : precheckValidation.reasons,
    aiOk: aiValidation.ok,
    aiScore: aiValidation.score,
    aiFailedChecks: aiValidation.failedChecks,
    aiFailedMissionIndexes: aiValidation.failedMissionIndexes,
    aiReasons: aiValidation.reasons,
    aiReviewComment: aiValidation.reviewComment,
    aiRewriteAdvice: aiValidation.rewriteAdvice,
    aiAbstractMissionIndexes: aiValidation.abstractMissionIndexes,
    aiRepeatedMissionIndexes: aiValidation.repeatedMissionIndexes,
    aiRewriteScope: aiValidation.rewriteScope,
    aiSuggestedTheme: aiValidation.rewrittenTheme,
    aiAppliedRepairStrategy: extras.appliedRepairStrategy || 'none',
    aiAppliedRepairIndexes: extras.appliedRepairIndexes || [],
    aiFieldSources: aiValidation.fieldSources,
    aiShouldRewrite: aiValidation.shouldRewrite,
    aiOriginalTheme: extras.originalTheme || null,
    aiValidationComplete: !!extras.validationComplete,
    aiValidationMissingFields: Array.isArray(extras.missingFields) ? extras.missingFields : [],
    aiRepairPromptCount: Number(extras.repairPromptCount) || 0,
    aiLoopPassCount: Number(extras.loopPassCount) || 1,
    aiLoopRewriteCount: Number(extras.loopRewriteCount) || 0,
    aiLoopStopReason: String(extras.loopStopReason || '').trim(),
    aiLoopPassSummaries: Array.isArray(extras.loopPassSummaries) ? extras.loopPassSummaries : [],
    aiLoopDetails: Array.isArray(extras.loopDetails) ? extras.loopDetails : [],
    secondaryValidationUsed: true,
  };
}

function decideAiRepairStrategy(aiValidation) {
  const failedMissionIndexes = Array.isArray(aiValidation && aiValidation.failedMissionIndexes)
    ? aiValidation.failedMissionIndexes
    : [];
  const requestedScope = String(aiValidation && aiValidation.rewriteScope || '').trim();
  if (failedMissionIndexes.length) {
    if (requestedScope === 'full' || requestedScope === 'mission-only') {
      return requestedScope;
    }
    return 'mission-only';
  }
  if (['mission-only', 'title-description', 'full'].includes(requestedScope)) {
    return requestedScope;
  }
  const failedChecks = Array.isArray(aiValidation && aiValidation.failedChecks)
    ? aiValidation.failedChecks
    : [];
  if (failedChecks.length && failedChecks.every((item) => ['concreteness', 'novelty'].includes(item))) {
    return 'mission-only';
  }
  return 'full';
}

function mergeThemeByRepairStrategy(theme, rewrittenTheme, aiValidation, strategy, walkMode) {
  const baseTheme = theme && typeof theme === 'object' ? theme : {};
  const suggestedTheme = rewrittenTheme && typeof rewrittenTheme === 'object' ? rewrittenTheme : {};
  const normalizedStrategy = strategy || 'full';
  const targetedIndexes = collectRepairTargetIndexes(aiValidation);
  if (normalizedStrategy === 'title-description') {
    if (targetedIndexes.length && Array.isArray(suggestedTheme.missions) && suggestedTheme.missions.length) {
      const currentMissions = Array.isArray(baseTheme.missions) ? [...baseTheme.missions] : [];
      targetedIndexes.forEach((missionIndex, offset) => {
        const replacement = suggestedTheme.missions[offset] || suggestedTheme.missions[missionIndex] || suggestedTheme.missions[0] || '';
        if (replacement) {
          currentMissions[missionIndex] = replacement;
        }
      });
      return normalizeTheme({
        ...baseTheme,
        title: String(suggestedTheme.title || '').trim() || baseTheme.title,
        description: String(suggestedTheme.description || '').trim() || baseTheme.description,
        missions: currentMissions,
      }, walkMode);
    }
    return normalizeTheme({
      ...baseTheme,
      title: String(suggestedTheme.title || '').trim() || baseTheme.title,
      description: String(suggestedTheme.description || '').trim() || baseTheme.description,
      missions: Array.isArray(baseTheme.missions) ? baseTheme.missions : [],
    }, walkMode);
  }
  if (normalizedStrategy === 'mission-only') {
    const currentMissions = Array.isArray(baseTheme.missions) ? [...baseTheme.missions] : [];
    const suggestedMissions = Array.isArray(suggestedTheme.missions) ? suggestedTheme.missions : [];
    if (targetedIndexes.length && suggestedMissions.length) {
      targetedIndexes.forEach((missionIndex, offset) => {
        const replacement = suggestedMissions[offset] || suggestedMissions[missionIndex] || suggestedMissions[0] || '';
        if (replacement) {
          currentMissions[missionIndex] = replacement;
        }
      });
    } else if (suggestedMissions.length) {
      return normalizeTheme({
        ...baseTheme,
        missions: suggestedMissions,
      }, walkMode);
    }
    return normalizeTheme({
      ...baseTheme,
      missions: currentMissions,
    }, walkMode);
  }
  return normalizeTheme({
    ...baseTheme,
    ...suggestedTheme,
  }, walkMode);
}

async function maybeRunSecondaryValidation(theme, event, fallbackTheme, options) {
  const originalTheme = snapshotTheme(theme);
  const baseValidation = summarizeThemeValidation(theme, event, {
    ...options,
    allowSecondaryValidation: true,
  });
  try {
    let currentTheme = theme;
    let finalValidation = summarizeThemeValidation(currentTheme, event, {
      ...options,
      allowSecondaryValidation: true,
    });
    const loopPassSummaries = [];
    let loopRewriteCount = 0;
    let totalRepairPromptCount = 0;
    let lastAppliedRepairStrategy = 'none';
    let lastAppliedRepairIndexes = [];
    let loopStopReason = 'passed';
    const loopDetails = [];

    for (let passIndex = 0; passIndex < VALIDATION_LOOP_MAX_PASSES; passIndex += 1) {
      const precheckValidation = summarizeThemeValidation(currentTheme, event, {
        ...options,
        allowSecondaryValidation: true,
      });
      const passInputTheme = snapshotTheme(currentTheme);
      const {
        aiValidation,
        rawPayload,
        missingFields,
        repairPromptCount,
        rawResponses,
      } = await requestCompleteAiValidation(currentTheme, event, options);
      const validationComplete = missingFields.length === 0;
      totalRepairPromptCount += repairPromptCount;
      const appliedRepairIndexes = collectRepairTargetIndexes(aiValidation);
      const passDetail = {
        pass: passIndex + 1,
        inputTheme: passInputTheme,
        precheck: summarizePrecheckValidation(precheckValidation),
        review: summarizeAiValidationForLoop(
          aiValidation,
          rawPayload,
          missingFields,
          repairPromptCount,
          validationComplete
        ),
        reviewAttempts: (Array.isArray(rawResponses) ? rawResponses : []).map((item, attemptIndex) => ({
          step: String(item && item.step || `attempt-${attemptIndex + 1}`).trim(),
          missingFields: Array.isArray(item && item.missingFields)
            ? item.missingFields.map((field) => String(field || '').trim()).filter(Boolean).slice(0, 12)
            : [],
          payload: cloneJsonSafe(item && item.payload) || null,
        })),
        appliedRepairStrategy: 'none',
        appliedRepairIndexes: [],
        reviewSuggestedTheme: snapshotTheme(aiValidation && aiValidation.rewrittenTheme ? aiValidation.rewrittenTheme : null),
        rewrittenTheme: null,
        stopReason: '',
      };

      loopPassSummaries.push({
        pass: passIndex + 1,
        score: aiValidation.score,
        ok: aiValidation.ok,
        shouldRewrite: aiValidation.shouldRewrite,
        rewriteScope: aiValidation.rewriteScope,
        missingFields,
        repairPromptCount,
      });

      if (!validationComplete) {
        loopStopReason = 'validation_incomplete_after_repair';
        passDetail.stopReason = loopStopReason;
        loopDetails.push(passDetail);
        finalValidation = buildValidationResult(precheckValidation, aiValidation, {
          validationComplete,
          missingFields,
          repairPromptCount: totalRepairPromptCount,
          loopPassCount: passIndex + 1,
          loopRewriteCount,
          loopStopReason,
          loopPassSummaries,
          loopDetails,
          originalTheme,
          appliedRepairStrategy: lastAppliedRepairStrategy,
          appliedRepairIndexes: lastAppliedRepairIndexes,
        });
        break;
      }

      if (!aiValidation.shouldRewrite || !aiValidation.rewrittenTheme) {
        loopStopReason = aiValidation.ok === false
          ? 'ai_rejected_without_rewrite'
          : 'passed';
        passDetail.stopReason = loopStopReason;
        loopDetails.push(passDetail);
        finalValidation = buildValidationResult(precheckValidation, aiValidation, {
          validationComplete,
          missingFields,
          repairPromptCount: totalRepairPromptCount,
          loopPassCount: passIndex + 1,
          loopRewriteCount,
          loopStopReason,
          loopPassSummaries,
          loopDetails,
          originalTheme,
          appliedRepairStrategy: lastAppliedRepairStrategy,
          appliedRepairIndexes: lastAppliedRepairIndexes,
        });
        break;
      }

      lastAppliedRepairStrategy = decideAiRepairStrategy(aiValidation);
      lastAppliedRepairIndexes = appliedRepairIndexes;
      let rewriteCandidate = aiValidation.rewrittenTheme;
      try {
        rewriteCandidate = await requestTargetedRewrite(currentTheme, event, aiValidation, options);
      } catch (rewriteError) {
        rewriteCandidate = aiValidation.rewrittenTheme;
      }
      const rewrittenTheme = mergeThemeByRepairStrategy(
        currentTheme,
        rewriteCandidate,
        aiValidation,
        lastAppliedRepairStrategy,
        event.walkMode
      );
      const alignedRewrittenTheme = forceThemeAlignment(rewrittenTheme, event, fallbackTheme);
      currentTheme = finalizeTheme(alignedRewrittenTheme, event, fallbackTheme, options);
      currentTheme = {
        ...currentTheme,
        finalization: {
          ...(currentTheme.finalization || {}),
          aiRepairStrategy: lastAppliedRepairStrategy,
          aiRepairIndexes: lastAppliedRepairIndexes,
          aiFailedChecks: aiValidation.failedChecks || [],
        },
      };
      loopRewriteCount += 1;
      passDetail.appliedRepairStrategy = lastAppliedRepairStrategy;
      passDetail.appliedRepairIndexes = lastAppliedRepairIndexes;
      passDetail.reviewSuggestedTheme = snapshotTheme(aiValidation.rewrittenTheme);
      passDetail.rewrittenTheme = snapshotTheme(currentTheme);
      passDetail.stopReason = passIndex === VALIDATION_LOOP_MAX_PASSES - 1
        ? 'max_validation_passes_reached'
        : 'rewrite_applied';
      loopDetails.push(passDetail);

      if (passIndex === VALIDATION_LOOP_MAX_PASSES - 1) {
        loopStopReason = 'max_validation_passes_reached';
        finalValidation = buildValidationResult(precheckValidation, aiValidation, {
          validationComplete,
          missingFields,
          repairPromptCount: totalRepairPromptCount,
          loopPassCount: passIndex + 1,
          loopRewriteCount,
          loopStopReason,
          loopPassSummaries,
          loopDetails,
          originalTheme,
          appliedRepairStrategy: lastAppliedRepairStrategy,
          appliedRepairIndexes: lastAppliedRepairIndexes,
        });
      }
    }

    const nextTheme = {
      ...currentTheme,
      finalization: {
        ...(currentTheme.finalization || {}),
        aiLoopPassCount: finalValidation.aiLoopPassCount || loopPassSummaries.length,
        aiLoopRewriteCount: finalValidation.aiLoopRewriteCount || loopRewriteCount,
        aiLoopStopReason: finalValidation.aiLoopStopReason || loopStopReason,
        aiRepairPromptCount: finalValidation.aiRepairPromptCount || totalRepairPromptCount,
        aiLoopDetails: Array.isArray(finalValidation.aiLoopDetails) ? finalValidation.aiLoopDetails : [],
        aiOriginalTheme: originalTheme,
        aiValidationComplete: finalValidation.aiValidationComplete !== undefined
          ? finalValidation.aiValidationComplete
          : true,
        aiValidationMissingFields: finalValidation.aiValidationMissingFields || [],
      },
    };

    return {
      theme: nextTheme,
      validation: finalValidation,
    };
  } catch (error) {
    return {
      theme,
      validation: {
        ...baseValidation,
        secondaryValidationUsed: true,
        secondaryValidationError: error.message || 'secondary_validation_failed',
      },
    };
  }
}

function shouldUseFallbackAfterValidation(validation) {
  const normalizedValidation = validation && typeof validation === 'object' ? validation : {};
  if (normalizedValidation.aiValidationComplete === false) {
    return true;
  }
  if (String(normalizedValidation.aiLoopStopReason || '').trim() === 'max_validation_passes_reached') {
    return true;
  }
  if (normalizedValidation.aiOk === false) {
    return true;
  }
  return false;
}

function buildValidationFallbackReason(validation) {
  const normalizedValidation = validation && typeof validation === 'object' ? validation : {};
  const parts = [];
  if (normalizedValidation.aiLoopStopReason) {
    parts.push(String(normalizedValidation.aiLoopStopReason));
  }
  if (Array.isArray(normalizedValidation.aiFailedChecks) && normalizedValidation.aiFailedChecks.length) {
    parts.push(`failed:${normalizedValidation.aiFailedChecks.join(',')}`);
  }
  if (normalizedValidation.aiScore != null) {
    parts.push(`score:${normalizedValidation.aiScore}`);
  }
  return parts.join(' | ') || 'validation_rejected';
}

exports.main = async (event) => {
  const ragContext = retrieveContext(event);
  const ragModelInput = buildRagModelInput(ragContext);
  const fallbackTheme = normalizeTheme(buildFallbackTheme(event, ragContext), event.walkMode);
  const prompt = buildPrompt(event, ragContext);

  try {
    const theme = normalizeTheme(await chatJson(
      '你是遛遛小程序的城市漫步策划助手。只返回合法 JSON，不要输出额外解释。',
      prompt
    ), event.walkMode);
    const alignedTheme = forceThemeAlignment(theme, event, fallbackTheme);
    const finalizedTheme = finalizeTheme(alignedTheme, event, fallbackTheme, {
      categories: normalizeSelectedThemes(event.selectedThemes, event),
      preferAnchoredFill: true,
    });
    const reviewResult = await maybeRunSecondaryValidation(finalizedTheme, event, fallbackTheme, {
      categories: normalizeSelectedThemes(event.selectedThemes, event),
      preferAnchoredFill: true,
      currentPlan: ragContext.generationPlan || null,
    });
    if (shouldUseFallbackAfterValidation(reviewResult.validation)) {
      const alignedFallbackTheme = forceThemeAlignment(fallbackTheme, event, fallbackTheme);
      const finalizedFallback = finalizeTheme(alignedFallbackTheme, event, fallbackTheme, {
        categories: normalizeSelectedThemes(event.selectedThemes, event),
        preferAnchoredFill: true,
      });
      return {
        theme: {
          ...finalizedFallback,
          finalization: {
            ...(finalizedFallback.finalization || {}),
            aiOriginalTheme: snapshotTheme(finalizedTheme),
            aiRepairStrategy: reviewResult.validation.aiAppliedRepairStrategy || 'none',
            aiRepairIndexes: reviewResult.validation.aiAppliedRepairIndexes || [],
            aiFailedChecks: reviewResult.validation.aiFailedChecks || [],
            aiValidationComplete: reviewResult.validation.aiValidationComplete,
            aiValidationMissingFields: reviewResult.validation.aiValidationMissingFields || [],
            aiLoopPassCount: reviewResult.validation.aiLoopPassCount || 0,
            aiLoopRewriteCount: reviewResult.validation.aiLoopRewriteCount || 0,
            aiLoopStopReason: reviewResult.validation.aiLoopStopReason || '',
            aiRepairPromptCount: reviewResult.validation.aiRepairPromptCount || 0,
            aiLoopDetails: reviewResult.validation.aiLoopDetails || [],
          },
        },
        source: 'rag-fallback',
        validation: reviewResult.validation,
        runtimeVersion: RUNTIME_VERSION,
        ragPlan: ragContext.generationPlan || null,
        ragDebug: ragContext.ragDebug || null,
        ragModelInput: {
          ragContext: ragModelInput,
          generationPlan: ragContext.generationPlan || null,
        },
        ragContext: includeDebugContext ? ragContext : undefined,
        reason: buildValidationFallbackReason(reviewResult.validation),
      };
    }
    return {
      theme: reviewResult.theme,
      source: 'rag+ai',
      validation: reviewResult.validation,
      runtimeVersion: RUNTIME_VERSION,
      ragPlan: ragContext.generationPlan || null,
      ragDebug: ragContext.ragDebug || null,
      ragModelInput: {
        ragContext: ragModelInput,
        generationPlan: ragContext.generationPlan || null,
      },
      ragContext: includeDebugContext ? ragContext : undefined,
    };
  } catch (error) {
    const alignedFallbackTheme = forceThemeAlignment(fallbackTheme, event, fallbackTheme);
    const finalizedFallback = finalizeTheme(alignedFallbackTheme, event, fallbackTheme, {
      categories: normalizeSelectedThemes(event.selectedThemes, event),
      preferAnchoredFill: true,
    });
    return {
      theme: finalizedFallback,
      source: 'rag-fallback',
      validation: summarizeThemeValidation(finalizedFallback, event, {
        categories: normalizeSelectedThemes(event.selectedThemes, event),
      }),
      runtimeVersion: RUNTIME_VERSION,
      ragPlan: ragContext.generationPlan || null,
      ragDebug: ragContext.ragDebug || null,
      ragModelInput: {
        ragContext: ragModelInput,
        generationPlan: ragContext.generationPlan || null,
      },
      ragContext: includeDebugContext ? ragContext : undefined,
      reason: error.message || 'generate_failed',
    };
  }
};

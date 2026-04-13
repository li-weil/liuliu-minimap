const cloud = require('wx-server-sdk');
const { chatJson } = require('./ai');
const { missionTemplates, sceneProfiles } = require('./knowledge');
const {
  normalizeLocationSignals,
  buildPromptContextBlock,
  finalizeTheme,
  summarizeThemeValidation,
  buildSecondaryValidationPrompt,
} = require('./runtime');
const { buildUnifiedRetrievalContext } = require('./rag-runtime');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const RUNTIME_VERSION = '2026-04-13-ai-validation-primary-r3';

function shuffle(list) {
  const copied = [...list];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copied[index], copied[swapIndex]] = [copied[swapIndex], copied[index]];
  }
  return copied;
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
  return {
    ...theme,
    missions: (theme.missions || []).map(normalizeMissionText).slice(0, missionCount),
  };
}

function enrichPureMissionText(mission, categories) {
  const text = String(mission || '').trim();
  if (!text) {
    return `找一处同时让你想到${categories.join('和')}的细节，留意它们为什么会在这里相遇`;
  }
  if (text.length >= 18 && text.length <= 36) {
    return text;
  }

  return `${text.replace(/[。！!]+$/g, '')}，留意它们为什么会在这里同时出现`;
}

function buildCombinedReferenceContext(categories, event) {
  const ragContext = buildUnifiedRetrievalContext(event, {
    selectedThemes: categories,
    requestedCategories: categories,
    missionTemplates,
    sceneProfiles,
  });

  return {
    ragContext,
  };
}

function buildModelCombinedReferenceContext(referenceContext) {
  const context = referenceContext && typeof referenceContext === 'object' ? referenceContext : {};
  const ragContext = context.ragContext && typeof context.ragContext === 'object' ? context.ragContext : null;
  const targetThemes = uniqText(
    ragContext && Array.isArray(ragContext.selectedThemes) && ragContext.selectedThemes.length
      ? ragContext.selectedThemes
      : (ragContext && Array.isArray(ragContext.categories) ? ragContext.categories : []),
    3
  );
  return {
    targetThemes,
    time: buildCompactTimeModel(ragContext ? ragContext.timeContext : null),
    nearby: buildCompactNearbyModel(ragContext ? ragContext.nearbySummary : null),
    sceneCards: buildCompactSceneCards(ragContext, targetThemes),
    themeReferences: buildCompactThemeReferences(ragContext, targetThemes),
  };
}

function uniqText(values, limit = 10) {
  const result = [];
  (Array.isArray(values) ? values : [values]).forEach((item) => {
    const text = String(item || '').trim();
    if (text && !result.includes(text) && result.length < limit) {
      result.push(text);
    }
  });
  return result;
}

function buildCompactTimeModel(timeContext) {
  const context = timeContext && typeof timeContext === 'object' ? timeContext : {};
  return {
    phase: context.timePhase || '',
    hints: uniqText(context.timeHints || [], 4),
  };
}

function buildCompactNearbyModel(nearbySummary) {
  const summary = nearbySummary && typeof nearbySummary === 'object' ? nearbySummary : {};
  return {
    poiNames: uniqText(summary.poiNames || [], 5),
    dominantScene: summary.dominantScene || '',
    activityHints: uniqText(summary.activityHints || [], 4),
  };
}

function buildCompactSceneCards(ragContext, categories) {
  const allowedCategories = new Set(uniqText(categories, 3));
  return (ragContext && Array.isArray(ragContext.scenes) ? ragContext.scenes : [])
    .slice(0, 3)
    .map((scene) => {
      const labels = uniqText(scene.labels || [], 2);
      return {
        label: labels.join(' / '),
        categories: uniqText(
          (Array.isArray(scene.categories) ? scene.categories : []).filter((category) => {
            return !allowedCategories.size || allowedCategories.has(category);
          }),
          3
        ),
        missionHints: uniqText(scene.missionHints || [], 3),
      };
    })
    .filter((scene) => scene.label || scene.missionHints.length);
}

function buildCompactThemeReferences(ragContext, categories) {
  return uniqText(categories, 3)
    .map((category) => ({
      category,
      references: (Array.isArray(ragContext && ragContext.referenceMissions) ? ragContext.referenceMissions : [])
        .filter((item) => item.category === category)
        .slice(0, 3)
        .map((item) => ({
          angle: item.angle,
          cues: uniqText(item.cues || [], 4),
        })),
    }))
    .filter((item) => item.references.length);
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

function buildSeedStyleGuide(seed) {
  const normalizedSeed = String(seed || '').trim();
  if (!normalizedSeed) {
    return [];
  }
  const actionStyles = [
    '优先让三个任务分别落在“比较 / 判断来源 / 停留变化”上，不要都写成“找一处”。',
    '优先让三个任务在动作上分开成“寻找 / 对照 / 解释相遇原因”，不要都写成同一种观察句。',
    '优先把三条任务拆成“对象 / 关系 / 变化”三种结构，不要只换几个词。',
  ];
  const anchorStyles = [
    '尽量更换锚点，不要三条都围绕同一个 POI 或入口句式。',
    '至少有一条任务用活动线索做切口，而不是继续围绕建筑名词。',
    '至少有一条任务从时间变化切入，而不是继续沿用静态描述。',
  ];
  return [
    actionStyles[Math.floor(hashStringToUnit(`${normalizedSeed}|action`) * actionStyles.length) % actionStyles.length],
    anchorStyles[Math.floor(hashStringToUnit(`${normalizedSeed}|anchor`) * anchorStyles.length) % anchorStyles.length],
  ];
}

function classifyAngleHint(text) {
  const value = String(text || '');
  if (/数字|编号|门牌|倒计时|票号|序号|罗马数字|汉字数字|英文数字|数量/.test(value)) {
    return '数字与数量';
  }
  if (/色|光影|明暗|渐变|反光|色块|色温|暖色|冷色/.test(value)) {
    return '色彩与光线';
  }
  if (/声|听|回声|脚步|节奏|报站|叫卖|广播|音乐/.test(value)) {
    return '声音与节奏';
  }
  if (/气味|闻|香气|烟火味|草木味|潮气|热气|药味/.test(value)) {
    return '气味与来源';
  }
  if (/弧|轮廓|边界|门洞|窗框|对称|几何|线条|转角/.test(value)) {
    return '形状与边界';
  }
  if (/排队|停留|穿行|换乘|进出|转场|动线|人流/.test(value)) {
    return '流动与停留';
  }
  if (/清晨|上午|午后|黄昏|夜间|凌晨/.test(value)) {
    return '时间变化';
  }
  return '空间关系';
}

function buildAngleDigest(referenceContext) {
  const angleMap = new Map();
  const scenes = (referenceContext.ragContext && referenceContext.ragContext.scenes) || [];
  const templates = (referenceContext.ragContext && referenceContext.ragContext.referenceMissions) || [];
  const cues = []
    .concat(scenes)
    .flatMap((scene) => {
      const labels = Array.isArray(scene.labels) ? scene.labels : [];
      const missionHints = Array.isArray(scene.missionHints) ? scene.missionHints : [];
      return labels.concat(missionHints);
    })
    .concat(templates)
    .flatMap((template) => (Array.isArray(template.cues) ? template.cues : []));

  cues.forEach((cue) => {
    const label = classifyAngleHint(cue);
    if (!angleMap.has(label)) {
      angleMap.set(label, { label, count: 0, examples: [] });
    }
    const bucket = angleMap.get(label);
    bucket.count += 1;
    if (bucket.examples.length < 3 && cue) {
      bucket.examples.push(cue);
    }
  });

  return Array.from(angleMap.values())
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);
}

function buildAntiPatterns(categories, referenceContext) {
  const normalizedCategories = uniqText(categories.map((item) => String(item || '').replace(/漫步/g, '').trim()), 3);
  const antiPatterns = [
    '不要把两个主题拆成互不相干的两段说明',
    '不要用任何地方都能成立的抽象句',
    '不要让三个任务写成同一句式改写',
    '不要引入第三个无关主题',
  ];

  if (normalizedCategories.includes('数字')) {
    antiPatterns.push('数字任务必须直接指向数量、编号、变体或行动线索');
  }
  if (normalizedCategories.includes('气味')) {
    antiPatterns.push('气味任务必须写出来源、扩散、停留或气味记忆');
  }
  if (normalizedCategories.includes('声音')) {
    antiPatterns.push('声音任务必须写出层次、来源、节奏或回响');
  }
  if (normalizedCategories.includes('形状')) {
    antiPatterns.push('形状任务必须写出轮廓、弧度、边界或几何关系');
  }
  if (normalizedCategories.includes('色彩')) {
    antiPatterns.push('色彩任务必须写出色块、对比、渐变、明暗或环境色调');
  }

  const sceneLabel = referenceContext && referenceContext.ragContext && Array.isArray(referenceContext.ragContext.scenes)
    ? (referenceContext.ragContext.scenes[0] && referenceContext.ragContext.scenes[0].labels && referenceContext.ragContext.scenes[0].labels.join(' / '))
    : '';
  if (sceneLabel && /景区|游览|地标/.test(sceneLabel)) {
    antiPatterns.push('不要引导进入受限区域，不要让任务依赖入场或越界');
  }

  const timePhase = referenceContext && referenceContext.ragContext && referenceContext.ragContext.timeContext
    ? referenceContext.ragContext.timeContext.timePhase
    : '';
  if (timePhase) {
    antiPatterns.push(`不要忽略当前是${timePhase}这个时间段`);
  }

  return uniqText(antiPatterns, 10);
}

function buildCategoryPlans(categories, referenceContext) {
  const angleDigest = buildAngleDigest(referenceContext);
  return uniqText(categories, 2).map((category, index) => {
    const categoryAngles = angleDigest.filter((angle) => {
      if (category === '数字') {
        return /数字|数量/.test(angle.label);
      }
      if (category === '气味') {
        return /气味/.test(angle.label);
      }
      if (category === '声音') {
        return /声音|节奏/.test(angle.label);
      }
      if (category === '形状') {
        return /形状|边界/.test(angle.label);
      }
      if (category === '色彩') {
        return /色彩|光线/.test(angle.label);
      }
      return true;
    });
    return {
      category,
      preferredAngles: uniqText(categoryAngles.length ? categoryAngles.map((item) => item.label) : angleDigest.map((item) => item.label), 4),
      anchors: uniqText(
        []
          .concat((referenceContext.ragContext && referenceContext.ragContext.referenceMissions) || [])
          .flatMap((template) => {
            return Array.isArray(template.cues) ? template.cues : [];
          }),
        8
      ).slice(index, index + 4),
    };
  });
}

function buildFusionBlueprints(categories, referenceContext, walkMode) {
  const missionCount = walkMode === 'advanced' ? 3 : 1;
  const angleDigest = buildAngleDigest(referenceContext);
  const sceneAnchors = uniqText(
    []
      .concat((referenceContext.ragContext && referenceContext.ragContext.nearbySummary && referenceContext.ragContext.nearbySummary.poiNames) || [])
      .concat((referenceContext.ragContext && referenceContext.ragContext.nearbySummary && referenceContext.ragContext.nearbySummary.activityHints) || [])
      .concat((referenceContext.ragContext && referenceContext.ragContext.scenes) || [])
      .flatMap((scene) => Array.isArray(scene.missionHints) ? scene.missionHints : []),
    14
  );
  const skeletons = [
    '融合：同一任务里同时看见两个方向',
    '比较：比较两个方向在同一地点的差异',
    '变化：观察两个方向如何在此刻发生变化',
    '来源：判断它们为什么会在这里相遇',
    '停留：在一个点上停下来感受两者如何叠加',
  ];
  const categoryPlans = buildCategoryPlans(categories, referenceContext);
  const priorities = angleDigest.length ? angleDigest : [{ label: '融合观察', examples: [] }];
  return Array.from({ length: missionCount }, (_, index) => {
    const angle = priorities[index % priorities.length];
    const anchor = sceneAnchors[index % sceneAnchors.length] || '';
    const focusCategory = categoryPlans[index % categoryPlans.length] || null;
    return {
      slot: index + 1,
      angle: angle.label,
      anchor,
      skeleton: skeletons[index % skeletons.length],
      categoryFocus: focusCategory ? focusCategory.category : '',
      categoryAngles: focusCategory ? focusCategory.preferredAngles : [],
      cues: uniqText(angle.examples || [], 2),
    };
  });
}

function buildGenerationPlan(categories, referenceContext, event) {
  return {
    focusThemes: uniqText(categories.map((item) => String(item || '').replace(/漫步/g, '').trim()), 3),
    dominantScene: referenceContext.ragContext && referenceContext.ragContext.nearbySummary
      ? referenceContext.ragContext.nearbySummary.dominantScene
      : '',
    timePhase: referenceContext.ragContext && referenceContext.ragContext.timeContext
      ? referenceContext.ragContext.timeContext.timePhase
      : '',
    angleDigest: buildAngleDigest(referenceContext),
    antiPatterns: buildAntiPatterns(categories, referenceContext),
    categoryPlans: buildCategoryPlans(categories, referenceContext),
    missionBlueprints: buildFusionBlueprints(categories, referenceContext, event.walkMode),
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

function normalizeAiValidationResult(payload) {
  const normalizedPayload = payload && typeof payload === 'object' ? payload : {};
  const rawReasons = Array.isArray(normalizedPayload.reasons)
    ? normalizedPayload.reasons.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const failedChecks = Array.isArray(normalizedPayload.failedChecks)
    ? normalizedPayload.failedChecks.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const abstractMissionIndexes = Array.isArray(normalizedPayload.abstractMissionIndexes)
    ? normalizedPayload.abstractMissionIndexes.map((item) => Number(item)).filter((item) => Number.isInteger(item)).slice(0, 6)
    : [];
  const repeatedMissionIndexes = Array.isArray(normalizedPayload.repeatedMissionIndexes)
    ? normalizedPayload.repeatedMissionIndexes.map((item) => Number(item)).filter((item) => Number.isInteger(item)).slice(0, 6)
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
      abstractMissionIndexes,
      repeatedMissionIndexes,
      rewriteScope,
      rewrittenTheme,
      fieldSources: {
        score: 'missing',
        failedChecks: failedChecks.length ? 'ai' : 'missing',
        reasons: 'missing',
        reviewComment: 'missing',
        rewriteAdvice: 'missing',
        rewrittenTheme: rewrittenTheme ? 'ai' : 'missing',
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
    abstractMissionIndexes,
    repeatedMissionIndexes,
    rewriteScope,
    rewrittenTheme,
    fieldSources: {
      score: hasScore ? 'ai' : 'missing',
      failedChecks: failedChecks.length ? 'ai' : 'missing',
      reasons: rawReasons.length ? 'ai' : 'missing',
      reviewComment: reviewComment ? 'ai' : 'missing',
      rewriteAdvice: rewriteAdvice ? 'ai' : 'missing',
      rewrittenTheme: rewrittenTheme ? 'ai' : 'missing',
    },
  };
}

function decideAiRepairStrategy(aiValidation) {
  const requestedScope = String(aiValidation && aiValidation.rewriteScope || '').trim();
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
  if (normalizedStrategy === 'title-description') {
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
    const targetedIndexes = []
      .concat(Array.isArray(aiValidation && aiValidation.abstractMissionIndexes) ? aiValidation.abstractMissionIndexes : [])
      .concat(Array.isArray(aiValidation && aiValidation.repeatedMissionIndexes) ? aiValidation.repeatedMissionIndexes : [])
      .filter((item, index, source) => Number.isInteger(item) && item >= 0 && source.indexOf(item) === index);
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
  let validation = summarizeThemeValidation(theme, event, {
    ...options,
    allowSecondaryValidation: true,
  });

  try {
    const aiValidation = normalizeAiValidationResult(await chatJson(
      '你是遛遛小程序的主题质检助手。只返回合法 JSON，不要输出额外解释。',
      buildSecondaryValidationPrompt(theme, event, options)
    ));
    if (!aiValidation) {
      return { theme, validation };
    }
    let nextTheme = theme;
    let appliedRepairStrategy = 'none';
    if (aiValidation.shouldRewrite && aiValidation.rewrittenTheme) {
      appliedRepairStrategy = decideAiRepairStrategy(aiValidation);
      const rewrittenTheme = mergeThemeByRepairStrategy(
        theme,
        aiValidation.rewrittenTheme,
        aiValidation,
        appliedRepairStrategy,
        event.walkMode
      );
      nextTheme = finalizeTheme(rewrittenTheme, event, fallbackTheme, options);
      nextTheme = {
        ...nextTheme,
        finalization: {
          ...(nextTheme.finalization || {}),
          aiRepairStrategy: appliedRepairStrategy,
          aiRepairIndexes: []
            .concat(aiValidation.abstractMissionIndexes || [])
            .concat(aiValidation.repeatedMissionIndexes || [])
            .filter((item, index, source) => Number.isInteger(item) && source.indexOf(item) === index),
          aiFailedChecks: aiValidation.failedChecks || [],
        },
      };
      validation = summarizeThemeValidation(nextTheme, event, {
        ...options,
        allowSecondaryValidation: true,
      });
    }
    return {
      theme: nextTheme,
      validation: {
        ...validation,
        ok: aiValidation.ok !== false,
        stage: 'ai-review',
        precheckScore: validation.score,
        precheckReasons: validation.reasons,
        score: aiValidation.score != null ? aiValidation.score : validation.score,
        reasons: aiValidation.reasons.length ? aiValidation.reasons : validation.reasons,
        aiOk: aiValidation.ok,
        aiScore: aiValidation.score,
        aiFailedChecks: aiValidation.failedChecks,
        aiReasons: aiValidation.reasons,
        aiReviewComment: aiValidation.reviewComment,
        aiRewriteAdvice: aiValidation.rewriteAdvice,
        aiAbstractMissionIndexes: aiValidation.abstractMissionIndexes,
        aiRepeatedMissionIndexes: aiValidation.repeatedMissionIndexes,
        aiRewriteScope: aiValidation.rewriteScope,
        aiSuggestedTheme: aiValidation.rewrittenTheme,
        aiAppliedRepairStrategy: appliedRepairStrategy,
        aiAppliedRepairIndexes: []
          .concat(aiValidation.abstractMissionIndexes || [])
          .concat(aiValidation.repeatedMissionIndexes || [])
          .filter((item, index, source) => Number.isInteger(item) && source.indexOf(item) === index),
        aiFieldSources: aiValidation.fieldSources,
        aiShouldRewrite: aiValidation.shouldRewrite,
        secondaryValidationUsed: true,
      },
    };
  } catch (error) {
    return {
      theme,
      validation: {
        ...validation,
        secondaryValidationUsed: true,
        secondaryValidationError: error.message || 'secondary_validation_failed',
      },
    };
  }
}

exports.main = async (event) => {
  const categories = Array.isArray(event.categories) ? event.categories.filter(Boolean).slice(0, 3) : [];
  if (event.walkMode === 'pure') {
    const pureTheme = {
      title: '纯粹探索',
      description: '纯粹模式只允许选择一个主题方向。',
      category: categories[0] || '探索',
      missions: ['请选择一个主题后重新生成'],
      vibeColor: '#5a5a40',
    };
    return {
      theme: pureTheme,
      source: 'combined-fallback',
      validation: summarizeThemeValidation(pureTheme, event, {
        categories,
        combined: true,
      }),
      runtimeVersion: RUNTIME_VERSION,
      ragPlan: null,
      ragDebug: null,
      reason: 'pure_mode_single_theme_only',
    };
  }
  if (categories.length < 2) {
    const needTheme = {
      title: '组合探索',
      description: '至少选择两个主题方向再进行组合。',
      category: '组合',
      missions: ['选择两个方向后再次生成'],
      vibeColor: '#7c6a94',
    };
    return {
      theme: needTheme,
      source: 'combined-fallback',
      validation: summarizeThemeValidation(needTheme, event, {
        categories,
        combined: true,
      }),
      runtimeVersion: RUNTIME_VERSION,
      ragPlan: null,
      ragDebug: null,
      reason: 'need_two_categories',
    };
  }

  const referenceContext = buildCombinedReferenceContext(categories, event);
  const modelReferenceContext = buildModelCombinedReferenceContext(referenceContext);
  const generationPlan = buildGenerationPlan(categories, referenceContext, event);
  const locationSignals = normalizeLocationSignals(event);
  const generationSeed = event.generationSeed
    || (event.generationContext && event.generationContext.generationSeed)
    || (event.generationContext
      && event.generationContext.contextPacket
      && event.generationContext.contextPacket.generation
      && event.generationContext.contextPacket.generation.seed)
    || '';
  const previousThemeTitle = event.generationContext
    && event.generationContext.contextPacket
    && event.generationContext.contextPacket.generation
    && event.generationContext.contextPacket.generation.previousThemeTitle
    ? String(event.generationContext.contextPacket.generation.previousThemeTitle).trim()
    : '';
  const previousMissions = uniqText(
    event.generationContext
      && event.generationContext.contextPacket
      && event.generationContext.contextPacket.generation
      && Array.isArray(event.generationContext.contextPacket.generation.previousMissions)
      ? event.generationContext.contextPacket.generation.previousMissions
      : [],
    3
  );
  const seedStyleGuide = buildSeedStyleGuide(generationSeed);
  const promptContext = buildPromptContextBlock(event, {
    categories,
    walkMode: event.walkMode,
    combined: true,
  });
  const fallbackTheme = normalizeTheme({
    title: `${categories.join(' × ')} 组合漫步`,
    description: `把 ${categories.join('、')} 放进 ${locationSignals.locationContext || locationSignals.locationName || '这片街区'} 的此刻。`,
    category: '组合',
    missions: event.walkMode === 'advanced'
      ? [
          '找到一个同时呼应这两个方向的场景',
          '拍下一处让多个感官同时被调动的细节',
          '用一句话解释它们为什么会在这里相遇',
        ]
      : [`在街头寻找一处能同时让你想到${categories.join('与')}的细节，观察它们如何彼此呼应，并说出最打动你的那个瞬间`],
    vibeColor: '#7c6a94',
  }, event.walkMode);

  const prompt = `你正在为微信小程序“遛遛”生成组合主题。
组合方向：${categories.join('、')}
${promptContext.text}
模式：${event.walkMode === 'advanced' ? '进阶模式，生成3个短而清楚的任务' : '纯粹模式，生成1个短而清楚的任务'}
本次变化种子：${generationSeed || '未提供'}
上一轮主题：${previousThemeTitle || '未提供'}
上一轮任务：${previousMissions.length ? previousMissions.join('；') : '未提供'}
本次句式偏好：${seedStyleGuide.length ? seedStyleGuide.join('；') : '未提供'}

以下是检索增强上下文（RAG），请把它当作 grounding，而不是脚本：
${JSON.stringify(modelReferenceContext, null, 2)}

生成计划：
${JSON.stringify(generationPlan, null, 2)}

要求：
1. 请创建一个真正融合这些方向的主题，而不是简单并列。
2. 三个任务切入角度尽量不同，可以分别从主体、关系、空间、时间、对比、来源、变化等角度切入。
3. 任务必须只围绕这两个方向展开，不要额外引入第三种无关主题。
4. 每个任务必须对应不同的 angle，不要把所有任务写成同一个句式。
5. 至少有一个任务要明确回应 categoryPlans 里的两个方向交集，不能只是各写各的。
6. 至少有一个任务要呼应附近 POI 或活动线索。
7. 如果没有选择“声音”，就不要把声音当任务重点。
7.1 如果没有选择“数字”，禁止把“数清、数一数、数出、几个、多少、编号”当成任务开头或核心动作。
8. 如果包含“数字”，至少有一个任务必须直接涉及数字形状、数量统计、数字变体或数字行动线索。
9. 如果包含“气味”，至少有一个任务必须直接涉及气味来源、扩散、停留或气味记忆。
10. 如果包含“形状”，至少有一个任务必须直接涉及线条、轮廓、弧度或几何关系。
11. 如果包含“色彩”，至少有一个任务必须直接涉及色块、对比、渐变、明暗或环境色调。
12. 必须遵守 antiPatterns，避免把结果写成抽象散文、重复句式或任何地方都能套用的空话。
13. 任务要具体、宽松、具有趣味，并且带有明确地点感和时间感。
14. 任务必须安全、可执行，不要进入受限区域。
15. 语言要像真实任务，不要写成散文，不要堆砌抽象修辞。
16. title 尽量控制在 12 个字以内，description 尽量控制在 32 个字以内。
17. 如果是纯粹模式，唯一的那个任务必须同时体现已选方向，并写成“动作 + 观察重点”的一句话，尽量控制在 32 个字以内。
18. 如果提供了附近 POI 或活动线索，至少有一个任务要能呼应这些附近信息。
19. 同一地点重复生成时，请根据“本次变化种子”改变任务的动作、锚点或观察角度，避免反复使用同一固定句式。
20. RAG 只提供 grounding、角度、线索和锚点；不要复用知识库样例句，不要把模板样例当成可直接粘贴的任务文本。
21. 如果提供了“上一轮任务”，请避免复用其中的开头动词、核心对象组合和句式骨架。
22. 至少有一个任务应在当前上下文里做出 RAG 里没有直接写出的新鲜融合关系，但仍然要贴合已选主题。

返回 JSON：title, description, category, missions, vibeColor。`;

  try {
    const theme = normalizeTheme(await chatJson('你是遛遛小程序的组合主题策划助手。只返回合法 JSON。', prompt), event.walkMode);
    const enrichedTheme = event.walkMode === 'pure'
      ? {
          ...theme,
          missions: [enrichPureMissionText((theme.missions || [])[0], categories)],
        }
      : theme;
    const finalizedTheme = finalizeTheme({ ...fallbackTheme, ...enrichedTheme, category: '组合' }, event, fallbackTheme, {
      categories,
      combined: true,
    });
    const reviewResult = await maybeRunSecondaryValidation(finalizedTheme, event, fallbackTheme, {
      categories,
      combined: true,
      currentPlan: generationPlan,
    });
    return {
      theme: reviewResult.theme,
      source: 'combined+ai',
      validation: reviewResult.validation,
      runtimeVersion: RUNTIME_VERSION,
      combinedCategories: categories,
      ragPlan: generationPlan,
      ragDebug: referenceContext.ragContext && referenceContext.ragContext.ragDebug ? referenceContext.ragContext.ragDebug : null,
      ragModelInput: {
        referenceContext: modelReferenceContext,
        generationPlan,
      },
    };
  } catch (error) {
    const finalizedFallback = finalizeTheme(fallbackTheme, event, fallbackTheme, {
      categories,
      combined: true,
    });
    return {
      theme: finalizedFallback,
      source: 'combined-fallback',
      validation: summarizeThemeValidation(finalizedFallback, event, {
        categories,
        combined: true,
      }),
      runtimeVersion: RUNTIME_VERSION,
      combinedCategories: categories,
      ragPlan: generationPlan,
      ragDebug: referenceContext.ragContext && referenceContext.ragContext.ragDebug ? referenceContext.ragContext.ragDebug : null,
      ragModelInput: {
        referenceContext: modelReferenceContext,
        generationPlan,
      },
      reason: error.message || 'generate_failed',
    };
  }
};

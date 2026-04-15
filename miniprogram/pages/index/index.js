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
const { fetchNearbyPois, getLocationContext, searchLocations } = require('../../services/map');
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

function normalizeRandomSource(source) {
  const normalized = String(source || '').trim();
  if (normalized === 'rag+ai') {
    return 'random+ai';
  }
  if (normalized === 'rag-fallback') {
    return 'random-fallback';
  }
  if (normalized === 'ai-direct') {
    return 'random-direct';
  }
  if (normalized === 'ai-direct-fallback') {
    return 'random-direct-fallback';
  }
  return normalized || 'random-fallback';
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

function normalizeGenerationValidationMeta(validation) {
  const normalizedValidation = validation && typeof validation === 'object' ? validation : null;
  if (!normalizedValidation) {
    return null;
  }
  const reasons = dedupeStrings(
    []
      .concat(Array.isArray(normalizedValidation.reasons) ? normalizedValidation.reasons : [])
      .concat(Array.isArray(normalizedValidation.aiReasons) ? normalizedValidation.aiReasons : []),
    6
  );
  return {
    stage: normalizedValidation.stage ? String(normalizedValidation.stage).trim() : '',
    ok: !!normalizedValidation.ok,
    hasAnchor: !!normalizedValidation.hasAnchor,
    genericMissionCount: Number(normalizedValidation.genericMissionCount) || 0,
    matchedMissionIndexes: Array.isArray(normalizedValidation.matchedMissionIndexes)
      ? normalizedValidation.matchedMissionIndexes.filter((item) => Number.isInteger(item)).slice(0, 5)
      : [],
    missingCategories: normalizeGenerationThemeList(normalizedValidation.missingCategories || []),
    categories: normalizeGenerationThemeList(normalizedValidation.categories || []),
    shouldRunSecondaryValidation: !!normalizedValidation.shouldRunSecondaryValidation,
    secondaryValidationUsed: !!normalizedValidation.secondaryValidationUsed,
    secondaryValidationError: normalizedValidation.secondaryValidationError
      ? String(normalizedValidation.secondaryValidationError).trim()
      : '',
    precheckScore: Number.isFinite(Number(normalizedValidation.precheckScore))
      ? Number(normalizedValidation.precheckScore)
      : null,
    precheckReasons: dedupeStrings(normalizedValidation.precheckReasons || [], 6),
    aiOk: normalizedValidation.aiOk === undefined ? null : !!normalizedValidation.aiOk,
    aiShouldRewrite: !!normalizedValidation.aiShouldRewrite,
    aiScore: Number.isFinite(Number(normalizedValidation.aiScore))
      ? Number(normalizedValidation.aiScore)
      : null,
    aiFailedChecks: dedupeStrings(normalizedValidation.aiFailedChecks || [], 6),
    aiFailedMissionIndexes: Array.isArray(normalizedValidation.aiFailedMissionIndexes)
      ? normalizedValidation.aiFailedMissionIndexes.filter((item) => Number.isInteger(item)).slice(0, 6)
      : [],
    aiAbstractMissionIndexes: Array.isArray(normalizedValidation.aiAbstractMissionIndexes)
      ? normalizedValidation.aiAbstractMissionIndexes.filter((item) => Number.isInteger(item)).slice(0, 6)
      : [],
    aiRepeatedMissionIndexes: Array.isArray(normalizedValidation.aiRepeatedMissionIndexes)
      ? normalizedValidation.aiRepeatedMissionIndexes.filter((item) => Number.isInteger(item)).slice(0, 6)
      : [],
    aiRewriteScope: String(normalizedValidation.aiRewriteScope || '').trim(),
    aiAppliedRepairStrategy: String(normalizedValidation.aiAppliedRepairStrategy || '').trim(),
    aiAppliedRepairIndexes: Array.isArray(normalizedValidation.aiAppliedRepairIndexes)
      ? normalizedValidation.aiAppliedRepairIndexes.filter((item) => Number.isInteger(item)).slice(0, 6)
      : [],
    aiValidationComplete: normalizedValidation.aiValidationComplete === undefined
      ? null
      : !!normalizedValidation.aiValidationComplete,
    aiValidationMissingFields: dedupeStrings(normalizedValidation.aiValidationMissingFields || [], 12),
    aiRepairPromptCount: Number.isFinite(Number(normalizedValidation.aiRepairPromptCount))
      ? Number(normalizedValidation.aiRepairPromptCount)
      : 0,
    aiLoopPassCount: Number.isFinite(Number(normalizedValidation.aiLoopPassCount))
      ? Number(normalizedValidation.aiLoopPassCount)
      : 0,
    aiLoopRewriteCount: Number.isFinite(Number(normalizedValidation.aiLoopRewriteCount))
      ? Number(normalizedValidation.aiLoopRewriteCount)
      : 0,
    aiLoopStopReason: String(normalizedValidation.aiLoopStopReason || '').trim(),
    aiLoopPassSummaries: (Array.isArray(normalizedValidation.aiLoopPassSummaries)
      ? normalizedValidation.aiLoopPassSummaries
      : [])
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        return {
          pass: Number.isFinite(Number(item.pass)) ? Number(item.pass) : null,
          score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
          ok: item.ok === undefined ? null : !!item.ok,
          shouldRewrite: item.shouldRewrite === undefined ? null : !!item.shouldRewrite,
          rewriteScope: String(item.rewriteScope || '').trim(),
          missingFields: dedupeStrings(item.missingFields || [], 8),
          repairPromptCount: Number.isFinite(Number(item.repairPromptCount)) ? Number(item.repairPromptCount) : 0,
        };
      })
      .filter(Boolean)
      .slice(0, 6),
    aiLoopDetails: (Array.isArray(normalizedValidation.aiLoopDetails)
      ? normalizedValidation.aiLoopDetails
      : [])
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        return {
          pass: Number.isFinite(Number(item.pass)) ? Number(item.pass) : null,
          validationComplete: item.review && item.review.validationComplete !== undefined
            ? !!item.review.validationComplete
            : item.validationComplete === undefined
              ? null
              : !!item.validationComplete,
          missingFields: dedupeStrings(
            []
              .concat(item.review && Array.isArray(item.review.missingFields) ? item.review.missingFields : [])
              .concat(Array.isArray(item.missingFields) ? item.missingFields : []),
            12
          ),
          repairPromptCount: Number.isFinite(Number(item.review && item.review.repairPromptCount))
            ? Number(item.review.repairPromptCount)
            : Number.isFinite(Number(item.repairPromptCount))
              ? Number(item.repairPromptCount)
              : 0,
          stopReason: String(item.stopReason || '').trim(),
          appliedRepairStrategy: String(item.appliedRepairStrategy || '').trim(),
          appliedRepairIndexes: Array.isArray(item.appliedRepairIndexes)
            ? item.appliedRepairIndexes.filter((value) => Number.isInteger(value)).slice(0, 6)
            : [],
          inputTheme: normalizeThemeSnapshotMeta(item.inputTheme),
          rewrittenTheme: normalizeThemeSnapshotMeta(item.rewrittenTheme),
          precheck: item.precheck && typeof item.precheck === 'object'
            ? {
                stage: String(item.precheck.stage || '').trim(),
                ok: item.precheck.ok === undefined ? null : !!item.precheck.ok,
                score: Number.isFinite(Number(item.precheck.score)) ? Number(item.precheck.score) : null,
                reasons: dedupeStrings(item.precheck.reasons || [], 8),
                hasAnchor: item.precheck.hasAnchor === undefined ? null : !!item.precheck.hasAnchor,
                anchorCount: Number.isFinite(Number(item.precheck.anchorCount)) ? Number(item.precheck.anchorCount) : 0,
                genericMissionCount: Number.isFinite(Number(item.precheck.genericMissionCount))
                  ? Number(item.precheck.genericMissionCount)
                  : 0,
                varietyRatio: Number.isFinite(Number(item.precheck.varietyRatio)) ? Number(item.precheck.varietyRatio) : null,
                similarPairCount: Number.isFinite(Number(item.precheck.similarPairCount)) ? Number(item.precheck.similarPairCount) : 0,
              }
            : null,
          review: item.review && typeof item.review === 'object'
            ? {
                stage: String(item.review.stage || '').trim(),
                ok: item.review.ok === undefined ? null : !!item.review.ok,
                score: Number.isFinite(Number(item.review.score)) ? Number(item.review.score) : null,
                failedChecks: dedupeStrings(item.review.failedChecks || [], 8),
                failedMissionIndexes: Array.isArray(item.review.failedMissionIndexes)
                  ? item.review.failedMissionIndexes.filter((value) => Number.isInteger(value)).slice(0, 6)
                  : [],
                abstractMissionIndexes: Array.isArray(item.review.abstractMissionIndexes)
                  ? item.review.abstractMissionIndexes.filter((value) => Number.isInteger(value)).slice(0, 6)
                  : [],
                repeatedMissionIndexes: Array.isArray(item.review.repeatedMissionIndexes)
                  ? item.review.repeatedMissionIndexes.filter((value) => Number.isInteger(value)).slice(0, 6)
                  : [],
                reasons: dedupeStrings(item.review.reasons || [], 8),
                reviewComment: String(item.review.reviewComment || '').trim(),
                rewriteAdvice: String(item.review.rewriteAdvice || '').trim(),
                shouldRewrite: item.review.shouldRewrite === undefined ? null : !!item.review.shouldRewrite,
                rewriteScope: String(item.review.rewriteScope || '').trim(),
                rewrittenTheme: normalizeThemeSnapshotMeta(item.review.rewrittenTheme),
                fieldPresence: item.review.fieldPresence && typeof item.review.fieldPresence === 'object'
                  ? item.review.fieldPresence
                  : null,
                fieldSources: item.review.fieldSources && typeof item.review.fieldSources === 'object'
                  ? item.review.fieldSources
                  : null,
                raw: item.review.raw && typeof item.review.raw === 'object'
                  ? item.review.raw
                  : null,
              }
            : null,
          reviewAttempts: (Array.isArray(item.reviewAttempts) ? item.reviewAttempts : [])
            .map((attempt) => {
              if (!attempt || typeof attempt !== 'object') {
                return null;
              }
              return {
                step: String(attempt.step || '').trim(),
                missingFields: dedupeStrings(attempt.missingFields || [], 12),
                payload: attempt.payload && typeof attempt.payload === 'object'
                  ? attempt.payload
                  : null,
              };
            })
            .filter(Boolean)
            .slice(0, 4),
        };
      })
      .filter(Boolean)
      .slice(0, 6),
    aiReviewComment: String(normalizedValidation.aiReviewComment || '').trim(),
    aiRewriteAdvice: String(normalizedValidation.aiRewriteAdvice || '').trim(),
    aiFieldSources: normalizedValidation.aiFieldSources && typeof normalizedValidation.aiFieldSources === 'object'
      ? {
          score: String(normalizedValidation.aiFieldSources.score || '').trim(),
          failedChecks: String(normalizedValidation.aiFieldSources.failedChecks || '').trim(),
          reasons: String(normalizedValidation.aiFieldSources.reasons || '').trim(),
          reviewComment: String(normalizedValidation.aiFieldSources.reviewComment || '').trim(),
          rewriteAdvice: String(normalizedValidation.aiFieldSources.rewriteAdvice || '').trim(),
          rewrittenTheme: String(normalizedValidation.aiFieldSources.rewrittenTheme || '').trim(),
        }
      : null,
    aiSuggestedTheme: normalizedValidation.aiSuggestedTheme && typeof normalizedValidation.aiSuggestedTheme === 'object'
      ? {
          title: String(normalizedValidation.aiSuggestedTheme.title || '').trim(),
          description: String(normalizedValidation.aiSuggestedTheme.description || '').trim(),
          missions: dedupeStrings(
            Array.isArray(normalizedValidation.aiSuggestedTheme.missions)
              ? normalizedValidation.aiSuggestedTheme.missions
              : [],
            6
          ),
        }
      : null,
    aiOriginalTheme: normalizedValidation.aiOriginalTheme && typeof normalizedValidation.aiOriginalTheme === 'object'
      ? {
          title: String(normalizedValidation.aiOriginalTheme.title || '').trim(),
          description: String(normalizedValidation.aiOriginalTheme.description || '').trim(),
          missions: dedupeStrings(
            Array.isArray(normalizedValidation.aiOriginalTheme.missions)
              ? normalizedValidation.aiOriginalTheme.missions
              : [],
            6
          ),
        }
      : null,
    reasons,
  };
}

function normalizeGenerationFinalizationMeta(finalization) {
  const normalizedFinalization = finalization && typeof finalization === 'object' ? finalization : null;
  if (!normalizedFinalization) {
    return null;
  }
  return {
    stage: normalizedFinalization.stage ? String(normalizedFinalization.stage).trim() : '',
    rewritten: !!normalizedFinalization.rewritten,
    replacementCount: Number(normalizedFinalization.replacementCount) || 0,
    anchoredReplacementCount: Number(normalizedFinalization.anchoredReplacementCount) || 0,
    fallbackReplacementCount: Number(normalizedFinalization.fallbackReplacementCount) || 0,
    aiRepairStrategy: String(normalizedFinalization.aiRepairStrategy || '').trim(),
    aiLoopPassCount: Number.isFinite(Number(normalizedFinalization.aiLoopPassCount))
      ? Number(normalizedFinalization.aiLoopPassCount)
      : 0,
    aiLoopRewriteCount: Number.isFinite(Number(normalizedFinalization.aiLoopRewriteCount))
      ? Number(normalizedFinalization.aiLoopRewriteCount)
      : 0,
    aiLoopStopReason: String(normalizedFinalization.aiLoopStopReason || '').trim(),
    aiRepairPromptCount: Number.isFinite(Number(normalizedFinalization.aiRepairPromptCount))
      ? Number(normalizedFinalization.aiRepairPromptCount)
      : 0,
    aiValidationComplete: normalizedFinalization.aiValidationComplete === undefined
      ? null
      : !!normalizedFinalization.aiValidationComplete,
    aiValidationMissingFields: dedupeStrings(normalizedFinalization.aiValidationMissingFields || [], 12),
    aiOriginalTheme: normalizedFinalization.aiOriginalTheme && typeof normalizedFinalization.aiOriginalTheme === 'object'
      ? normalizeThemeSnapshotMeta(normalizedFinalization.aiOriginalTheme)
      : null,
    aiLoopDetails: (Array.isArray(normalizedFinalization.aiLoopDetails)
      ? normalizedFinalization.aiLoopDetails
      : [])
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        return {
          pass: Number.isFinite(Number(item.pass)) ? Number(item.pass) : null,
          stopReason: String(item.stopReason || '').trim(),
          appliedRepairStrategy: String(item.appliedRepairStrategy || '').trim(),
          appliedRepairIndexes: Array.isArray(item.appliedRepairIndexes)
            ? item.appliedRepairIndexes.filter((value) => Number.isInteger(value)).slice(0, 6)
            : [],
          inputTheme: normalizeThemeSnapshotMeta(item.inputTheme),
          rewrittenTheme: normalizeThemeSnapshotMeta(item.rewrittenTheme),
        };
      })
      .filter(Boolean)
      .slice(0, 6),
    aiRepairIndexes: Array.isArray(normalizedFinalization.aiRepairIndexes)
      ? normalizedFinalization.aiRepairIndexes
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item))
        .slice(0, 8)
      : [],
    aiFailedChecks: dedupeStrings(normalizedFinalization.aiFailedChecks || [], 8),
    changedMissionIndexes: Array.isArray(normalizedFinalization.changedMissionIndexes)
      ? normalizedFinalization.changedMissionIndexes
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item))
        .slice(0, 8)
      : [],
    reasons: dedupeStrings(normalizedFinalization.reasons || [], 8),
    beforeMissions: dedupeStrings(normalizedFinalization.beforeMissions || [], 6),
    afterMissions: dedupeStrings(normalizedFinalization.afterMissions || [], 6),
    changeLog: (Array.isArray(normalizedFinalization.changeLog) ? normalizedFinalization.changeLog : [])
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const missionIndex = Number(item.missionIndex);
        return {
          type: String(item.type || '').trim(),
          missionIndex: Number.isInteger(missionIndex) ? missionIndex : null,
          before: String(item.before || '').trim(),
          after: String(item.after || '').trim(),
          reason: String(item.reason || '').trim(),
        };
      })
      .filter(Boolean)
      .slice(0, 8),
  };
}

function buildValidationSummary(generationSource, generationValidation) {
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
  if (!generationValidation) {
    return {
      status: '云函数未返回',
      details: '本次结果带有 source，但没有返回 validation，通常表示当前云函数还是旧版本',
      score: isDirectMode ? '未启用' : 'AI 未提供',
      precheckScore: '未提供',
      missingCategories: [],
      reasons: [],
    };
  }

  const status = [
    generationValidation.ok ? '通过' : '待修正',
    isDirectMode
      ? '基础检查'
      : generationValidation.secondaryValidationUsed
        ? 'AI 复核'
        : (generationValidation.stage === 'rule' ? '规则校验' : generationValidation.stage || ''),
  ].filter(Boolean).join(' · ');
  const details = [
    generationValidation.hasAnchor ? '有在地锚点' : '缺少在地锚点',
    generationValidation.genericMissionCount > 0 ? `泛化任务 ${generationValidation.genericMissionCount} 条` : '任务不泛',
    !isDirectMode && generationValidation.aiOk === false ? 'AI 复核未通过' : '',
    !isDirectMode && generationValidation.aiShouldRewrite ? 'AI 建议重写' : '',
    !isDirectMode && generationValidation.secondaryValidationError ? 'AI 复核失败' : '',
  ].filter(Boolean).join('；') || '未提供';

  return {
    status,
    details,
    score: !isDirectMode && generationValidation.aiScore !== null && generationValidation.aiScore !== undefined
      ? generationValidation.aiScore
      : isDirectMode
        ? '未启用'
        : 'AI 未提供',
    precheckScore: generationValidation.precheckScore !== null && generationValidation.precheckScore !== undefined
      ? generationValidation.precheckScore
      : '未提供',
    missingCategories: generationValidation.missingCategories || [],
    reasons: generationValidation.aiReasons && generationValidation.aiReasons.length
      ? generationValidation.aiReasons
      : [],
  };
}

function normalizeSceneScoreBreakdown(value = {}) {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return Object.keys(value).reduce((result, key) => {
    const score = Number(value[key]);
    if (Number.isFinite(score)) {
      result[key] = score;
    }
    return result;
  }, {});
}

function normalizeGenerationRagPlanMeta(ragPlan) {
  const normalizedPlan = ragPlan && typeof ragPlan === 'object' ? ragPlan : null;
  if (!normalizedPlan) {
    return null;
  }
  return {
    focusTheme: String(normalizedPlan.focusTheme || '').trim(),
    focusThemes: normalizeGenerationThemeList(normalizedPlan.focusThemes || []),
    targetThemes: normalizeGenerationThemeList(normalizedPlan.targetThemes || []),
    plannerMode: String(normalizedPlan.plannerMode || '').trim(),
    chosenScene: String(normalizedPlan.chosenScene || '').trim(),
    sceneId: String(normalizedPlan.sceneId || '').trim(),
    dominantScene: String(normalizedPlan.dominantScene || '').trim(),
    timePhase: String(normalizedPlan.timePhase || '').trim(),
    primaryAnchors: dedupeStrings(normalizedPlan.primaryAnchors || [], 8),
    recommendedAngles: dedupeStrings(normalizedPlan.recommendedAngles || [], 6),
    antiPatterns: dedupeStrings(normalizedPlan.antiPatterns || [], 8),
    supportingScenes: dedupeStrings(normalizedPlan.supportingScenes || [], 4),
    categoryPlans: (Array.isArray(normalizedPlan.categoryPlans) ? normalizedPlan.categoryPlans : [])
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        return {
          category: String(item.category || '').trim(),
          preferredAngles: dedupeStrings(item.preferredAngles || [], 4),
          anchors: dedupeStrings(item.anchors || [], 4),
        };
      })
      .filter(Boolean)
      .slice(0, 3),
    missionBlueprints: (Array.isArray(normalizedPlan.missionBlueprints) ? normalizedPlan.missionBlueprints : [])
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        return {
          slot: Number.isFinite(Number(item.slot)) ? Number(item.slot) : null,
          angle: String(item.angle || '').trim(),
          anchor: String(item.anchor || '').trim(),
          skeleton: String(item.skeleton || '').trim(),
          categoryFocus: String(item.categoryFocus || '').trim(),
          categoryAngles: dedupeStrings(item.categoryAngles || [], 4),
          examples: dedupeStrings(item.examples || [], 3),
          cues: dedupeStrings(item.cues || [], 3),
        };
      })
      .filter(Boolean)
      .slice(0, 4),
    missionPlans: (Array.isArray(normalizedPlan.missionPlans) ? normalizedPlan.missionPlans : [])
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        return {
          slot: Number.isFinite(Number(item.slot)) ? Number(item.slot) : null,
          theme: String(item.theme || '').trim(),
          actionType: String(item.actionType || '').trim(),
          actionInstruction: String(item.actionInstruction || '').trim(),
          anchor: String(item.anchor || '').trim(),
          scene: String(item.scene || '').trim(),
          timePhase: String(item.timePhase || '').trim(),
          observationAngle: String(item.observationAngle || '').trim(),
          avoidPhrases: dedupeStrings(item.avoidPhrases || [], 6),
          avoidRecentPatterns: dedupeStrings(item.avoidRecentPatterns || [], 4),
        };
      })
      .filter(Boolean)
      .slice(0, 4),
  };
}

function normalizeGenerationRagDebugMeta(ragDebug) {
  const normalizedDebug = ragDebug && typeof ragDebug === 'object' ? ragDebug : null;
  if (!normalizedDebug) {
    return null;
  }
  return {
    retrievalQuality: String(normalizedDebug.retrievalQuality || '').trim(),
    plannerMode: String(normalizedDebug.plannerMode || '').trim(),
    recentHistorySize: Number.isFinite(Number(normalizedDebug.recentHistorySize))
      ? Number(normalizedDebug.recentHistorySize)
      : null,
    themeCoverage: normalizeGenerationThemeList(normalizedDebug.themeCoverage || []),
    anchorCoverage: dedupeStrings(normalizedDebug.anchorCoverage || [], 8),
    diversityAngles: dedupeStrings(normalizedDebug.diversityAngles || [], 6),
    antiPatterns: dedupeStrings(normalizedDebug.antiPatterns || [], 8),
    selectedReferenceIds: dedupeStrings(normalizedDebug.selectedReferenceIds || [], 8),
    sceneCoverage: (Array.isArray(normalizedDebug.sceneCoverage) ? normalizedDebug.sceneCoverage : [])
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        return {
          id: String(item.id || '').trim(),
          label: String(item.label || '').trim(),
          score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
          scoreBreakdown: normalizeSceneScoreBreakdown(item.scoreBreakdown),
        };
      })
      .filter(Boolean)
      .slice(0, 4),
  };
}

function normalizeGenerationRagModelInputMeta(ragModelInput) {
  return ragModelInput && typeof ragModelInput === 'object' ? ragModelInput : null;
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

function applyGeneratedThemeMetaToContext(generationContext, theme, source = '', validation = null, runtimeVersion = '', ragPlan = null, ragDebug = null, ragModelInput = null, errorReason = '', modelRequest = null, modelResponse = null) {
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
  const normalizedValidation = normalizeGenerationValidationMeta(validation);
  const normalizedFinalization = normalizeGenerationFinalizationMeta(theme && theme.finalization);
  const normalizedRagPlan = normalizeGenerationRagPlanMeta(ragPlan);
  const normalizedRagDebug = normalizeGenerationRagDebugMeta(ragDebug);
  const normalizedRagModelInput = normalizeGenerationRagModelInputMeta(ragModelInput);
  const normalizedModelRequest = normalizeGenerationModelRequestMeta(modelRequest);
  const normalizedModelResponse = normalizeGenerationModelResponseMeta(modelResponse);
  const recentMissionHistory = appendThemeToRecentMissionHistory(generationPacket.recentMissionHistory || [], theme, source);
  return {
    ...baseContext,
    ...generatedThemeMeta,
    generationSource: source || baseContext.generationSource || '',
    generationValidation: normalizedValidation,
    generationFinalization: normalizedFinalization,
    generationRagPlan: normalizedRagPlan,
    generationRagDebug: normalizedRagDebug,
    generationRagModelInput: normalizedRagModelInput,
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
      validation: normalizedValidation,
      finalization: normalizedFinalization,
      rag: {
        plan: normalizedRagPlan,
        debug: normalizedRagDebug,
        modelInput: normalizedRagModelInput,
      },
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

function buildLocationNativeEvidence(contextResponse) {
  const nativeContext = contextResponse && contextResponse.nativeContext && typeof contextResponse.nativeContext === 'object'
    ? contextResponse.nativeContext
    : {};
  const aois = Array.isArray(nativeContext.aois) ? nativeContext.aois.filter(Boolean).slice(0, 6) : [];
  const businessAreas = Array.isArray(nativeContext.businessAreas) ? nativeContext.businessAreas.filter(Boolean).slice(0, 6) : [];
  const primaryAoi = aois[0] || null;
  return {
    aois,
    businessAreas,
    primaryAoiName: primaryAoi && primaryAoi.name ? String(primaryAoi.name).trim() : '',
    primaryAoiType: primaryAoi ? getAoiOfficialTypeLabel(primaryAoi) : '',
    primaryAoiTypecode: primaryAoi ? getAoiOfficialTypecode(primaryAoi) : '',
    aoiTypecodes: dedupeStrings(aois.map((item) => getAoiOfficialTypecode(item)), 8),
  };
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
  const poiNames = dedupeStrings(places.map((item) => item.name), 8);
  const poiTypes = dedupeStrings(places.map((item) => buildNativeCategoryLabel(item)), 8);
  const poiTypecodes = dedupeStrings(places.map((item) => item.typecode), 12);
  const sceneCandidates = buildNearbyNativeCategories(places, nativeEvidence);
  const topCategory = sceneCandidates[0] || null;
  return {
    poiNames,
    poiTypes,
    poiTypecodes,
    dominantScene: topCategory && topCategory.label
      ? topCategory.label
      : nativeEvidence.primaryAoiType || nativeEvidence.primaryAoiName || '',
    dominantSceneId: topCategory && topCategory.id
      ? topCategory.id
      : nativeEvidence.primaryAoiTypecode || '',
    sceneCandidates,
    aoiNames: dedupeStrings((nativeEvidence.aois || []).map((item) => item.name), 6),
    aoiTypecodes: nativeEvidence.aoiTypecodes || [],
    primaryAoiName: nativeEvidence.primaryAoiName,
    primaryAoiType: nativeEvidence.primaryAoiType,
    primaryAoiTypecode: nativeEvidence.primaryAoiTypecode,
    businessAreaNames: dedupeStrings((nativeEvidence.businessAreas || []).map((item) => item.name), 6),
    activityHints: inferNativeActivityHints(places, timeContext, nativeEvidence, topCategory),
    source: 'amap-native',
  };
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
  const sceneTag = pageData.locationContext || '';
  const nearbySummary = buildNearbySummary(
    pageData.nearbyPlaces,
    pageData.locationContextResponse || null,
    timeContext
  );
  const generatedThemeMeta = buildGeneratedThemeMeta(pageData.currentTheme);
  const contextPacket = {
    location: {
      name: pageData.locationName || '当前位置',
      address: pageData.locationAddress || '',
      latitude: Number.isFinite(Number(pageData.latitude)) ? Number(pageData.latitude) : null,
      longitude: Number.isFinite(Number(pageData.longitude)) ? Number(pageData.longitude) : null,
      sceneTag,
      nativeContext: pageData.locationContextResponse && pageData.locationContextResponse.nativeContext
        ? pageData.locationContextResponse.nativeContext
        : null,
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
    locationContext: sceneTag,
    sceneTag,
    locationContextResponse: pageData.locationContextResponse || null,
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

function buildValidationLoopCards(generationValidation, generationFinalization) {
  const loopDetails = generationValidation && Array.isArray(generationValidation.aiLoopDetails)
    ? generationValidation.aiLoopDetails
    : generationFinalization && Array.isArray(generationFinalization.aiLoopDetails)
      ? generationFinalization.aiLoopDetails
      : [];
  return loopDetails.map((item, index) => {
    const review = item.review || {};
    const precheck = item.precheck || {};
    const attempts = Array.isArray(item.reviewAttempts) ? item.reviewAttempts : [];
    const summaryRows = [
      { label: '轮次', value: formatDebugValue(item.pass || index + 1) },
      { label: '结构预检', value: formatDebugValue(precheck.score !== null && precheck.score !== undefined ? precheck.score : '未提供') },
      { label: 'AI 分数', value: formatDebugValue(review.score !== null && review.score !== undefined ? review.score : '未提供') },
      { label: 'AI 结果', value: formatDebugValue(review.ok === null || review.ok === undefined ? '未提供' : (review.ok ? '通过' : '未通过')) },
      { label: '建议改写', value: formatDebugValue(review.shouldRewrite === null || review.shouldRewrite === undefined ? '未提供' : (review.shouldRewrite ? '是' : '否')) },
      { label: '改写范围', value: formatDebugValue(review.rewriteScope || '未提供') },
      { label: '实际策略', value: formatDebugValue(item.appliedRepairStrategy || '未提供') },
      { label: '修复序号', value: formatDebugValue(item.appliedRepairIndexes || []) },
      { label: '缺失字段', value: formatDebugValue(item.missingFields || []) },
      { label: '补全次数', value: formatDebugValue(item.repairPromptCount) },
      { label: '停止原因', value: formatDebugValue(item.stopReason || '未提供') },
    ];
    return {
      key: `validation-loop-${item.pass || index + 1}`,
      title: `第 ${item.pass || index + 1} 轮`,
      summaryRows,
      inputThemeLines: buildJsonLines(item.inputTheme),
      precheckLines: buildJsonLines(item.precheck),
      reviewLines: buildJsonLines(item.review && item.review.raw ? item.review.raw : item.review),
      rewrittenSuggestionLines: buildJsonLines(review.rewrittenTheme),
      rewrittenThemeLines: buildJsonLines(item.rewrittenTheme),
      attemptCards: attempts.map((attempt, attemptIndex) => ({
        key: `validation-loop-${item.pass || index + 1}-attempt-${attemptIndex + 1}`,
        title: attempt.step || `attempt-${attemptIndex + 1}`,
        missingFields: formatDebugValue(attempt.missingFields || []),
        lines: buildJsonLines(attempt.payload),
      })),
    };
  });
}

function formatRagSceneCoverage(sceneCoverage) {
  return (Array.isArray(sceneCoverage) ? sceneCoverage : [])
    .map((item) => {
      if (!item) {
        return '';
      }
      const score = item.score !== null && item.score !== undefined ? `分数:${item.score}` : '分数:未提供';
      return [item.label || item.id || '', item.id ? `id:${item.id}` : '', score].filter(Boolean).join(' · ');
    })
    .filter(Boolean);
}

function formatRagMissionBlueprints(missionBlueprints) {
  return (Array.isArray(missionBlueprints) ? missionBlueprints : [])
    .map((item) => {
      if (!item) {
        return '';
      }
      return [
        item.slot ? `#${item.slot}` : '',
        item.angle ? `角度:${item.angle}` : '',
        item.anchor ? `锚点:${item.anchor}` : '',
        item.skeleton ? `骨架:${item.skeleton}` : '',
        item.categoryFocus ? `主题:${item.categoryFocus}` : '',
        item.cues && item.cues.length ? `线索:${item.cues.join('/')}` : '',
      ].filter(Boolean).join(' · ');
    })
    .filter(Boolean);
}

function formatRagCategoryPlans(categoryPlans) {
  return (Array.isArray(categoryPlans) ? categoryPlans : [])
    .map((item) => {
      if (!item) {
        return '';
      }
      return [
        item.category || '',
        item.preferredAngles && item.preferredAngles.length ? `角度:${item.preferredAngles.join('/')}` : '',
        item.anchors && item.anchors.length ? `锚点:${item.anchors.join('/')}` : '',
      ].filter(Boolean).join(' · ');
    })
    .filter(Boolean);
}

function buildRagExplainRows(ragPlan, ragDebug) {
  const plan = ragPlan || {};
  const debug = ragDebug || {};
  const rows = [
    {
      group: 'RAG 计划',
      label: 'targetThemes',
      value: formatDebugValue(plan.targetThemes || []),
      help: '本次检索必须服务的主题。用户显式选择主题时，这里应和主题输入一致，例如数字漫步应显示“数字”。',
    },
    {
      group: 'RAG 计划',
      label: 'chosenScene',
      value: formatDebugValue(plan.chosenScene),
      help: '最终选中的主场景文案，应该优先来自附近摘要里的 dominantScene 或最高分场景候选。',
    },
    {
      group: 'RAG 计划',
      label: 'sceneId',
      value: formatDebugValue(plan.sceneId),
      help: '最终选中主场景的内部 ID，用来排查 chosenScene 是否和 sceneCandidates 的第一名一致。',
    },
    {
      group: 'RAG 计划',
      label: 'supportingScenes',
      value: formatDebugValue(plan.supportingScenes || []),
      help: '次要参考场景，只作为补充语境，不应该盖过 chosenScene。',
    },
    {
      group: 'RAG 计划',
      label: 'recommendedAngles',
      value: formatDebugValue(plan.recommendedAngles || []),
      help: '建议任务切入角度，来自被召回的任务模板，用来减少任务重复。',
    },
    {
      group: 'RAG 计划',
      label: 'primaryAnchors',
      value: formatDebugValue(plan.primaryAnchors || []),
      help: '模型应优先落到的附近锚点，通常来自 POI、场景线索和模板 cues。',
    },
    {
      group: 'RAG 计划',
      label: 'antiPatterns',
      value: formatDebugValue(plan.antiPatterns || []),
      help: '这次生成应避免的写法，比如空泛观察、散文腔或偏离主题。',
    },
    {
      group: 'RAG 计划',
      label: 'categoryPlans',
      value: formatDebugValue(formatRagCategoryPlans(plan.categoryPlans)),
      help: '组合主题专用。说明每个主题方向各自应该抓哪些角度和锚点。',
    },
    {
      group: 'RAG 计划',
      label: 'missionBlueprints',
      value: formatDebugValue(formatRagMissionBlueprints(plan.missionBlueprints)),
      help: '随机或组合链路的任务蓝图，描述每条任务建议使用的角度、锚点和骨架。',
    },
    {
      group: 'RAG 调试',
      label: 'retrievalQuality',
      value: formatDebugValue(debug.retrievalQuality),
      help: '检索质量粗略标记。high 表示有召回任务模板，low 表示参考资料不足。',
    },
    {
      group: 'RAG 调试',
      label: 'themeCoverage',
      value: formatDebugValue(debug.themeCoverage || []),
      help: '检索实际覆盖到的主题方向，用来检查是否漏掉用户选择。',
    },
    {
      group: 'RAG 调试',
      label: 'sceneCoverage',
      value: formatDebugValue(formatRagSceneCoverage(debug.sceneCoverage)),
      help: '场景候选和分数。第一项通常应该对应 plan.chosenScene / sceneId。',
    },
    {
      group: 'RAG 调试',
      label: 'anchorCoverage',
      value: formatDebugValue(debug.anchorCoverage || []),
      help: 'RAG 认为可用的在地锚点，应和附近 POI、活动线索或主场景有关。',
    },
    {
      group: 'RAG 调试',
      label: 'diversityAngles',
      value: formatDebugValue(debug.diversityAngles || []),
      help: '用于拉开任务差异的角度集合，进阶模式尤其应该有多个不同角度。',
    },
    {
      group: 'RAG 调试',
      label: 'selectedReferenceIds',
      value: formatDebugValue(debug.selectedReferenceIds || []),
      help: '被召回的任务模板 ID，方便回查知识库里到底用了哪些参考。',
    },
    {
      group: 'RAG 入模',
      label: 'modelInput',
      value: formatDebugValue(ragPlan || ragDebug ? '已提供，见下方 rag.modelInput 原文' : ''),
      help: '这是真正放进 prompt 的 RAG 参考对象。单主题通常是 ragContext；随机/组合通常是 referenceContext + generationPlan。',
    },
  ];
  return rows
    .filter((item) => item.value !== '未提供')
    .map((item) => ({
      ...item,
      key: `${item.group}-${item.label}`,
    }));
}

function buildGenerationDebugState(generationContext) {
  const contextPacket = generationContext && generationContext.contextPacket && typeof generationContext.contextPacket === 'object'
    ? generationContext.contextPacket
    : null;
  const generationSource = generationContext && generationContext.generationSource
    ? String(generationContext.generationSource)
    : '';
  const generationValidation = generationContext && generationContext.generationValidation && typeof generationContext.generationValidation === 'object'
    ? generationContext.generationValidation
    : (contextPacket && contextPacket.validation && typeof contextPacket.validation === 'object'
      ? contextPacket.validation
      : null);
  const generationErrorReason = generationContext && generationContext.generationErrorReason
    ? String(generationContext.generationErrorReason)
    : (contextPacket && contextPacket.generation && contextPacket.generation.errorReason
      ? String(contextPacket.generation.errorReason)
      : '');
  const generationFinalization = generationContext && generationContext.generationFinalization && typeof generationContext.generationFinalization === 'object'
    ? generationContext.generationFinalization
    : (contextPacket && contextPacket.finalization && typeof contextPacket.finalization === 'object'
      ? contextPacket.finalization
      : null);
  const generationRagPlan = generationContext && generationContext.generationRagPlan && typeof generationContext.generationRagPlan === 'object'
    ? generationContext.generationRagPlan
    : (contextPacket && contextPacket.rag && contextPacket.rag.plan && typeof contextPacket.rag.plan === 'object'
      ? contextPacket.rag.plan
      : null);
  const generationRagDebug = generationContext && generationContext.generationRagDebug && typeof generationContext.generationRagDebug === 'object'
    ? generationContext.generationRagDebug
    : (contextPacket && contextPacket.rag && contextPacket.rag.debug && typeof contextPacket.rag.debug === 'object'
      ? contextPacket.rag.debug
      : null);
  const generationRagModelInput = generationContext && generationContext.generationRagModelInput && typeof generationContext.generationRagModelInput === 'object'
    ? generationContext.generationRagModelInput
    : (contextPacket && contextPacket.rag && contextPacket.rag.modelInput && typeof contextPacket.rag.modelInput === 'object'
      ? contextPacket.rag.modelInput
      : null);
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
  const runtimeVersion = generationContext && generationContext.runtimeVersion
    ? String(generationContext.runtimeVersion)
    : (contextPacket && contextPacket.runtimeVersion ? String(contextPacket.runtimeVersion) : '');
  const isDirectMode = /direct/.test(generationSource || '');
  if (!contextPacket) {
    return {
      lastGenerationContext: generationContext || null,
      debugContextAvailable: false,
      debugContextRows: [],
      debugRagRows: [],
      debugContextLines: [],
      debugRagPlanLines: [],
      debugRagDebugLines: [],
      debugRagModelInputLines: [],
      debugModelRequestLines: [],
      debugModelResponseLines: [],
      debugValidationLoopCards: [],
    };
  }

  const validationSummary = buildValidationSummary(generationSource, generationValidation);
  const ragThemes = generationRagPlan
    ? dedupeStrings(
      []
        .concat(generationRagPlan.focusThemes || [])
        .concat(generationRagPlan.targetThemes || [])
        .concat(generationRagDebug && generationRagDebug.themeCoverage ? generationRagDebug.themeCoverage : []),
      6
    )
    : [];
  const ragSceneValue = generationRagPlan
    ? dedupeStrings(
      []
        .concat(generationRagPlan.chosenScene || [])
        .concat(generationRagPlan.dominantScene || [])
        .concat(generationRagPlan.supportingScenes || [])
        .concat(generationRagDebug && generationRagDebug.sceneCoverage
          ? generationRagDebug.sceneCoverage.map((item) => item.label || item.id)
          : []),
      6
    )
    : [];
  const ragAngles = generationRagPlan
    ? dedupeStrings(
      []
        .concat(generationRagPlan.recommendedAngles || [])
        .concat(generationRagDebug && generationRagDebug.diversityAngles ? generationRagDebug.diversityAngles : []),
      6
    )
    : [];
  const ragAnchors = generationRagPlan
    ? dedupeStrings(
      []
        .concat(generationRagPlan.primaryAnchors || [])
        .concat(generationRagDebug && generationRagDebug.anchorCoverage ? generationRagDebug.anchorCoverage : []),
      8
    )
    : [];
  const ragAntiPatterns = generationRagPlan
    ? dedupeStrings(
      []
        .concat(generationRagPlan.antiPatterns || [])
        .concat(generationRagDebug && generationRagDebug.antiPatterns ? generationRagDebug.antiPatterns : []),
      8
    )
    : [];
  const ragQuality = generationRagDebug && generationRagDebug.retrievalQuality
    ? generationRagDebug.retrievalQuality
    : '';
  const ragBlueprints = generationRagPlan && generationRagPlan.missionBlueprints && generationRagPlan.missionBlueprints.length
    ? generationRagPlan.missionBlueprints.map((item) => {
      const parts = [
        item.slot ? `#${item.slot}` : '',
        item.angle || '',
        item.anchor ? `锚点:${item.anchor}` : '',
        item.skeleton ? `骨架:${item.skeleton}` : '',
      ].filter(Boolean);
      return parts.join(' · ');
    })
    : [];
  const finalizationSummary = generationFinalization
    ? [
      generationFinalization.rewritten ? '已改写' : '未改写',
      generationFinalization.replacementCount > 0 ? `共改 ${generationFinalization.replacementCount} 处` : '',
      generationFinalization.anchoredReplacementCount > 0 ? `锚点改写 ${generationFinalization.anchoredReplacementCount} 处` : '',
      generationFinalization.fallbackReplacementCount > 0 ? `fallback 改写 ${generationFinalization.fallbackReplacementCount} 处` : '',
      generationFinalization.aiRepairStrategy ? `AI 策略 ${generationFinalization.aiRepairStrategy}` : '',
    ].filter(Boolean).join(' · ')
    : '';

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
      label: isDirectMode ? '检查状态' : '验证状态',
      value: formatDebugValue(validationSummary.status),
    },
    {
      label: isDirectMode ? '检查细节' : '验证细节',
      value: formatDebugValue(validationSummary.details),
    },
    {
      label: '结构预检分数',
      value: formatDebugValue(validationSummary.precheckScore),
    },
    {
      label: '缺失主题',
      value: formatDebugValue(validationSummary.missingCategories),
    },
    {
      label: isDirectMode ? '检查说明' : '复核原因',
      value: formatDebugValue(validationSummary.reasons.length ? validationSummary.reasons : (isDirectMode ? '未提供' : 'AI 未提供')),
    },
    {
      label: 'Finalize 改写',
      value: formatDebugValue(finalizationSummary || '未提供'),
    },
    {
      label: '改写原因',
      value: formatDebugValue(generationFinalization && generationFinalization.reasons),
    },
    {
      label: isDirectMode ? 'Finalize 策略' : 'Finalize AI 策略',
      value: formatDebugValue(generationFinalization && generationFinalization.aiRepairStrategy),
    },
    {
      label: isDirectMode ? 'Finalize 改写序号' : 'Finalize AI 序号',
      value: formatDebugValue(generationFinalization && generationFinalization.aiRepairIndexes),
    },
    {
      label: isDirectMode ? 'Finalize 失败项' : 'Finalize AI 失败项',
      value: formatDebugValue(generationFinalization && generationFinalization.aiFailedChecks),
    },
    {
      label: 'Finalize 原始结果',
      value: formatDebugValue(generationFinalization && generationFinalization.aiOriginalTheme
        ? JSON.stringify(generationFinalization.aiOriginalTheme, null, 2)
        : '未提供'),
    },
    {
      label: 'Finalize AI 循环',
      value: formatDebugValue(generationFinalization
        ? [
            generationFinalization.aiLoopPassCount ? `轮次:${generationFinalization.aiLoopPassCount}` : '',
            Number.isFinite(Number(generationFinalization.aiLoopRewriteCount)) ? `改写:${generationFinalization.aiLoopRewriteCount}` : '',
            Number.isFinite(Number(generationFinalization.aiRepairPromptCount)) ? `补全:${generationFinalization.aiRepairPromptCount}` : '',
            generationFinalization.aiLoopStopReason ? `停止:${generationFinalization.aiLoopStopReason}` : '',
          ].filter(Boolean)
        : '未提供'),
    },
    {
      label: 'Finalize AI 缺失字段',
      value: formatDebugValue(generationFinalization && generationFinalization.aiValidationMissingFields),
    },
    {
      label: '改写前任务',
      value: formatDebugValue(generationFinalization && generationFinalization.beforeMissions),
    },
    {
      label: '改写后任务',
      value: formatDebugValue(generationFinalization && generationFinalization.afterMissions),
    },
    ...(!isDirectMode ? [
      {
        label: 'AI 分数',
        value: formatDebugValue(validationSummary.score),
      },
      {
        label: 'AI 失败项',
        value: formatDebugValue(generationValidation && generationValidation.aiFailedChecks),
      },
      {
        label: '失败任务序号',
        value: formatDebugValue(generationValidation && generationValidation.aiFailedMissionIndexes),
      },
      {
        label: 'AI 校验完整性',
        value: formatDebugValue(
          generationValidation && generationValidation.aiValidationComplete === false
            ? '不完整'
            : generationValidation && generationValidation.aiValidationComplete === true
              ? '完整'
              : '未提供'
        ),
      },
      {
        label: 'AI 缺失字段',
        value: formatDebugValue(generationValidation && generationValidation.aiValidationMissingFields),
      },
      {
        label: 'AI 补全次数',
        value: formatDebugValue(
          generationValidation && Number.isFinite(Number(generationValidation.aiRepairPromptCount))
            ? generationValidation.aiRepairPromptCount
            : '未提供'
        ),
      },
      {
        label: 'AI 循环轮次',
        value: formatDebugValue(
          generationValidation && Number.isFinite(Number(generationValidation.aiLoopPassCount)) && generationValidation.aiLoopPassCount
            ? generationValidation.aiLoopPassCount
            : '未提供'
        ),
      },
      {
        label: 'AI 改写次数',
        value: formatDebugValue(
          generationValidation && Number.isFinite(Number(generationValidation.aiLoopRewriteCount))
            ? generationValidation.aiLoopRewriteCount
            : '未提供'
        ),
      },
      {
        label: 'AI 循环停止原因',
        value: formatDebugValue(generationValidation && generationValidation.aiLoopStopReason),
      },
      {
        label: '抽象任务序号',
        value: formatDebugValue(generationValidation && generationValidation.aiAbstractMissionIndexes),
      },
      {
        label: '重复任务序号',
        value: formatDebugValue(generationValidation && generationValidation.aiRepeatedMissionIndexes),
      },
      {
        label: '改写范围',
        value: formatDebugValue(
          generationValidation && generationValidation.aiRewriteScope
            ? generationValidation.aiRewriteScope
            : '未提供'
        ),
      },
      {
        label: '实际修复策略',
        value: formatDebugValue(
          generationValidation && generationValidation.aiAppliedRepairStrategy
            ? generationValidation.aiAppliedRepairStrategy
            : '未提供'
        ),
      },
      {
        label: '实际修复序号',
        value: formatDebugValue(generationValidation && generationValidation.aiAppliedRepairIndexes),
      },
      {
        label: 'AI 评语',
        value: formatDebugValue(
          generationValidation && generationValidation.aiReviewComment
            ? generationValidation.aiReviewComment
            : 'AI 未提供'
        ),
      },
      {
        label: '改写建议',
        value: formatDebugValue(
          generationValidation && generationValidation.aiRewriteAdvice
            ? generationValidation.aiRewriteAdvice
            : 'AI 未提供'
        ),
      },
      {
        label: '建议改写内容',
        value: formatDebugValue(generationValidation && generationValidation.aiShouldRewrite
          ? (
            generationValidation.aiSuggestedTheme
              ? JSON.stringify(generationValidation.aiSuggestedTheme, null, 2)
              : 'AI 未提供'
          )
          : '无需改写'),
      },
      {
        label: 'AI 改写前原始结果',
        value: formatDebugValue(generationValidation && generationValidation.aiOriginalTheme
          ? JSON.stringify(generationValidation.aiOriginalTheme, null, 2)
          : '未提供'),
      },
      {
        label: 'AI 字段来源',
        value: formatDebugValue(generationValidation && generationValidation.aiFieldSources
          ? [
              `score:${generationValidation.aiFieldSources.score || 'missing'}`,
              `failedChecks:${generationValidation.aiFieldSources.failedChecks || 'missing'}`,
              `reasons:${generationValidation.aiFieldSources.reasons || 'missing'}`,
              `comment:${generationValidation.aiFieldSources.reviewComment || 'missing'}`,
              `advice:${generationValidation.aiFieldSources.rewriteAdvice || 'missing'}`,
              `rewrite:${generationValidation.aiFieldSources.rewrittenTheme || 'missing'}`,
            ]
          : '未提供'),
      },
      {
        label: 'RAG 质量',
        value: formatDebugValue(ragQuality || '未提供'),
      },
      {
        label: 'RAG 主题',
        value: formatDebugValue(ragThemes),
      },
      {
        label: 'RAG 场景',
        value: formatDebugValue(ragSceneValue),
      },
      {
        label: 'RAG 角度',
        value: formatDebugValue(ragAngles),
      },
      {
        label: 'RAG 锚点',
        value: formatDebugValue(ragAnchors),
      },
      {
        label: 'RAG 反例',
        value: formatDebugValue(ragAntiPatterns),
      },
      {
        label: '任务蓝图',
        value: formatDebugValue(ragBlueprints),
      },
    ] : []),
    {
      label: '地点',
      value: formatDebugValue(contextPacket.location && contextPacket.location.name),
    },
    {
      label: '场景标签',
      value: formatDebugValue(contextPacket.location && contextPacket.location.sceneTag),
    },
    {
      label: '时间段',
      value: formatDebugValue(contextPacket.time && contextPacket.time.timePhase),
    },
    {
      label: '时间线索',
      value: formatDebugValue(contextPacket.time && contextPacket.time.timeHints),
    },
    {
      label: '附近场景',
      value: formatDebugValue(contextPacket.nearby && contextPacket.nearby.dominantScene),
    },
    {
      label: '附近 POI',
      value: formatDebugValue(contextPacket.nearby && contextPacket.nearby.poiNames),
    },
    {
      label: '活动线索',
      value: formatDebugValue(contextPacket.nearby && contextPacket.nearby.activityHints),
    },
    {
      label: '上一轮主题',
      value: formatDebugValue(contextPacket.generation && contextPacket.generation.previousThemeTitle),
    },
    {
      label: '上一轮任务',
      value: formatDebugValue(contextPacket.generation && contextPacket.generation.previousMissions),
    },
    {
      label: '主题输入',
      value: formatDebugValue(contextPacket.userState && contextPacket.userState.selectedThemes),
    },
    {
      label: '生成主题',
      value: formatDebugValue(contextPacket.userState && contextPacket.userState.generatedThemeCategory),
    },
    {
      label: '模型名称',
      value: formatDebugValue(
        generationModelRequest
        && generationModelRequest.request
        && generationModelRequest.request.model
      ),
    },
  ];

  return {
    lastGenerationContext: generationContext,
    debugContextAvailable: true,
    debugContextRows: rows,
    debugRagRows: isDirectMode ? [] : buildRagExplainRows(generationRagPlan, generationRagDebug),
    debugContextLines: JSON.stringify(contextPacket, null, 2).split('\n'),
    debugRagPlanLines: isDirectMode ? [] : (generationRagPlan ? JSON.stringify(generationRagPlan, null, 2).split('\n') : []),
    debugRagDebugLines: isDirectMode ? [] : (generationRagDebug ? JSON.stringify(generationRagDebug, null, 2).split('\n') : []),
    debugRagModelInputLines: isDirectMode ? [] : (generationRagModelInput ? JSON.stringify(generationRagModelInput, null, 2).split('\n') : []),
    debugModelRequestLines: generationModelRequest ? buildReadableModelRequestLines(generationModelRequest) : [],
    debugModelResponseLines: generationModelResponse ? buildReadableModelRequestLines(generationModelResponse) : [],
    debugValidationLoopCards: isDirectMode ? [] : buildValidationLoopCards(generationValidation, generationFinalization),
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
  return /路|街|巷|道|号|弄|村|大道/.test(text) && /\d/.test(text);
}

function pickBestLocationName({ location, amapSummary, contextResponse }) {
  const candidates = [
    amapSummary && amapSummary.pois && amapSummary.pois[0] && amapSummary.pois[0].name,
    location && location.placeName,
    location && location.name,
    amapSummary && amapSummary.placeName,
    contextResponse && contextResponse.placeName,
    location && location.address,
  ]
    .map((item) => (item ? String(item).trim() : ''))
    .filter(Boolean);

  const nonAddressLike = candidates.find((item) => !looksLikeStreetAddress(item) && item !== '地图选点');
  return nonAddressLike || candidates[0] || '当前位置';
}

function buildNearbyPlaceViews(results) {
  return (results || []).slice(0, NEARBY_QUERY_OPTIONS.limit).map((item, index) => {
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
  }).filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
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

  if (/function not found|找不到该函数|not found/i.test(message)) {
    return {
      title: '周边地点功能未部署',
      content: '云函数 fetchNearbyPois 还没有部署到当前云环境，请先上传并部署该云函数后再试。',
    };
  }

  if (/missing_amap_web_key/i.test(message)) {
    return {
      title: '缺少高德服务 Key',
      content: '云函数 fetchNearbyPois 没有配置可用的高德 Web 服务 Key。请在云函数环境变量里设置 AMAP_WEB_KEY 后，再重新部署并重试。',
    };
  }

  if (/INVALID_USER_KEY|USERKEY_PLAT_NOMATCH|SERVICE_NOT_AVAILABLE|DAILY_QUERY_OVER_LIMIT|ACCESS_TOO_FREQUENT|INVALID_IP/i.test(message)) {
    return {
      title: '高德 Key 权限异常',
      content: `高德周边 POI 请求失败：${message}。请检查当前 Key 是否开通 Web 服务能力、配额是否超限、平台权限是否匹配。`,
    };
  }

  if (/timeout|超时/i.test(message)) {
    return {
      title: '周边地点请求超时',
      content: `请求高德周边 POI 超时：${message}。请检查网络状态后重试。`,
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
    debugContextLines: [],
    showGenerationDebug: false,
    supportsNearbyPois: false,
    privacyPopup: createDefaultPrivacyPopup(),
  },

  onLoad() {
    this.locationResolveToken = 0;
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
    app.globalData.currentTheme = currentTheme;
    this.syncDisplayMeta(currentTheme, 'preset', 'pure');
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
      'ai-direct-fallback': '直出兜底',
      'rag+ai': 'AI 生成',
      'rag-fallback': 'RAG 兜底',
      'random-direct': '随机直出',
      'random-direct-fallback': '随机兜底',
      'random+ai': '随机 AI',
      'random-fallback': '随机兜底',
      'combined-direct': '组合直出',
      'combined-direct-fallback': '组合兜底',
      'combined+ai': '组合 AI',
      'combined-fallback': '组合兜底',
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
    this.setData({ showGenerationDebug: !this.data.showGenerationDebug });
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

  async enrichLocation(location) {
    const token = ++this.locationResolveToken;
    const regeo = await getRegeo(location).catch(() => null);
    const amapSummary = normalizeAmapLocation(regeo, location.placeName || location.name || location.address);
    const displayLocationName = pickBestLocationName({
      location,
      amapSummary,
      contextResponse: null,
    });
    const locationContextResult = await getLocationContext({
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      placeName: displayLocationName,
    }).catch(() => null);
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
      nearbyPlaces: [],
      nearbyExpanded: false,
      lastGenerationContext: null,
    });
    this.loadNearbyPlaces(location.latitude, location.longitude).then(() => {
      if (token !== this.locationResolveToken) {
        return;
      }
      if (this.data.nearbyPlaces.length) {
        this.setData({ nearbyExpanded: true });
      }
    });
  },

  async loadNearbyPlaces(latitude, longitude) {
    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
      this.setData({ nearbyPlaces: [], nearbyExpanded: false, loadingNearbyPlaces: false });
      return;
    }

    this.setData({ loadingNearbyPlaces: true });
    try {
      const nearbyPlaces = buildNearbyPlaceViews(await fetchNearbyPois(Number(latitude), Number(longitude), NEARBY_QUERY_OPTIONS));
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
      const result = await getLocationContext({
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
      const nearbyPlaces = buildNearbyPlaceViews(await fetchNearbyPois(latitude, longitude, NEARBY_QUERY_OPTIONS));
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
    const sceneTag = locationContextResult && locationContextResult.context
      ? String(locationContextResult.context).trim()
      : (this.data.locationContext || '');
    const nearbySummary = buildNearbySummary(
      nearbyPlaces && nearbyPlaces.length ? nearbyPlaces : this.data.nearbyPlaces,
      locationContextResult || this.data.locationContextResponse || null,
      timeContext
    );
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
        name: this.data.locationName || '当前位置',
        address: this.data.locationAddress || '',
        latitude: Number.isFinite(Number(this.data.latitude)) ? Number(this.data.latitude) : null,
        longitude: Number.isFinite(Number(this.data.longitude)) ? Number(this.data.longitude) : null,
        sceneTag,
        nativeContext: locationContextResult && locationContextResult.nativeContext
          ? locationContextResult.nativeContext
          : this.data.locationContextResponse && this.data.locationContextResponse.nativeContext
            ? this.data.locationContextResponse.nativeContext
            : null,
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
      locationContext: sceneTag,
      sceneTag,
      locationContextResponse: locationContextResult || this.data.locationContextResponse || null,
      timeContext,
      nearbySummary,
      generationSeed: contextPacket.generation.seed,
      contextPacket,
    };
    return {
      ...basePayload,
      ...generationContext,
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
    this.setData({ isGenerating: true });
    try {
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
      this.setData(buildGenerationDebugState(payload.generationContext));
      const result = useCombinedTheme
        ? await generateCombinedTheme({
          ...payload,
          categories: normalizedSelections,
        })
        : await generateTheme(payload);
      const currentTheme = trimTheme({ ...result.theme, allMissions: result.theme.missions, locationName: this.data.locationName }, this.data.walkMode);
      const nextGenerationContext = applyGeneratedThemeMetaToContext(
        payload.generationContext,
        currentTheme,
        result.source || (useCombinedTheme ? 'combined-fallback' : 'rag-fallback'),
        result.validation || null,
        result.runtimeVersion || '',
        result.ragPlan || null,
        result.ragDebug || null,
        result.ragModelInput || null,
        result.reason || '',
        result.modelRequest || null,
        result.modelResponse || null
      );
      this.setData({
        currentTheme,
        ...buildGenerationDebugState(nextGenerationContext),
      });
      app.globalData.currentTheme = currentTheme;
      this.syncDisplayMeta(currentTheme, result.source || (useCombinedTheme ? 'combined-fallback' : 'rag-fallback'));
    } catch (error) {
      wx.showModal({
        title: '主题生成失败',
        content: extractErrorMessage(error, '主题生成失败'),
        showCancel: false,
        confirmText: '知道了',
      });
    } finally {
      this.setData({ isGenerating: false });
    }
  },

  async handleRandomTheme() {
    if (!this.ensureExplorePointReadyForGeneration()) {
      return;
    }
    this.setData({ isGenerating: true });
    try {
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
      this.setData(buildGenerationDebugState(payload.generationContext));
      const result = await generateTheme({
        ...payload,
        selectedThemes,
      });
      const displaySource = normalizeRandomSource(result.source);
      const currentTheme = trimTheme({ ...result.theme, allMissions: result.theme.missions, locationName: this.data.locationName }, this.data.walkMode);
      const nextGenerationContext = applyGeneratedThemeMetaToContext(
        payload.generationContext,
        currentTheme,
        displaySource,
        result.validation || null,
        result.runtimeVersion || '',
        result.ragPlan || null,
        result.ragDebug || null,
        result.ragModelInput || null,
        result.reason || '',
        result.modelRequest || null,
        result.modelResponse || null
      );
      this.setData({
        currentTheme,
        ...buildGenerationDebugState(nextGenerationContext),
      });
      app.globalData.currentTheme = currentTheme;
      this.syncDisplayMeta(currentTheme, displaySource);
    } catch (error) {
      wx.showModal({
        title: '随机生成失败',
        content: extractErrorMessage(error, '随机生成失败'),
        showCancel: false,
        confirmText: '知道了',
      });
    } finally {
      this.setData({ isGenerating: false });
    }
  },

  async handleSelectedThemeGenerate() {
    if (!this.ensureExplorePointReadyForGeneration()) {
      return;
    }
    this.setData({ isCombining: true });
    try {
      const normalizedSelections = normalizeCombineSelections(this.data.combineSelections, this.data.walkMode);
      if (normalizedSelections.length !== this.data.combineSelections.length) {
        this.setData({
          combineSelections: normalizedSelections,
          combineOptionViews: buildCombineOptionViews(normalizedSelections),
        });
      }
      const selections = normalizedSelections.length
        ? normalizedSelections
        : [pickRandomThemeCategory(this.data.randomCategories)];
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
      this.setData(buildGenerationDebugState(payload.generationContext));
      const result = !useCombinedTheme
        ? await generateTheme({
          ...payload,
          selectedThemes: buildSelectedThemeCategories(selections),
        })
        : await generateCombinedTheme({
          ...payload,
          categories: selections,
        });
      const currentTheme = trimTheme({ ...result.theme, allMissions: result.theme.missions, locationName: this.data.locationName }, this.data.walkMode);
      const nextGenerationContext = applyGeneratedThemeMetaToContext(
        payload.generationContext,
        currentTheme,
        result.source || (useCombinedTheme ? 'combined-fallback' : 'rag-fallback'),
        result.validation || null,
        result.runtimeVersion || '',
        result.ragPlan || null,
        result.ragDebug || null,
        result.ragModelInput || null,
        result.reason || '',
        result.modelRequest || null,
        result.modelResponse || null
      );
      this.setData({
        currentTheme,
        ...buildGenerationDebugState(nextGenerationContext),
      });
      app.globalData.currentTheme = currentTheme;
      this.syncDisplayMeta(
        currentTheme,
        result.source || (useCombinedTheme ? 'combined-fallback' : 'rag-fallback')
      );
    } catch (error) {
      wx.showModal({
        title: '选择生成失败',
        content: extractErrorMessage(error, '选择生成失败'),
        showCancel: false,
        confirmText: '知道了',
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
        locationContext: this.data.locationContext || generationContext.sceneTag || '',
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
        locationContext: this.data.locationContext || generationContext.sceneTag || '',
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
        locationContext: this.data.locationContext || generationContext.sceneTag || '',
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

const cloud = require('wx-server-sdk');
const { chatJsonWithMeta, getAiConfig } = require('./ai');
const {
  normalizeLocationSignals,
  normalizeTimeContext,
  summarizeCoreTimeHints,
  normalizeNearbySummary,
  buildPreferenceContext,
  buildPreparedRuntimeContext,
  buildPromptContextBlock,
  summarizeStructureCheck,
  buildTaskSkeletonGroups,
  compactMission,
  missionsAreSimilar,
} = require('./runtime');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const RUNTIME_VERSION = '2026-04-16-combined-direct-ai-fallback-r12';

function buildModelRequestDebug(systemPrompt, userPrompt) {
  const config = getAiConfig();
  return {
    provider: 'dashscope-compatible',
    request: {
      model: config.model,
      temperature: 1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    },
  };
}

function buildModelResponseDebug(responseMeta) {
  const meta = responseMeta && typeof responseMeta === 'object' ? responseMeta : {};
  return {
    responseId: String(meta.responseId || '').trim(),
    model: String(meta.responseModel || '').trim(),
    finishReason: String(meta.finishReason || '').trim(),
    usage: meta.usage && typeof meta.usage === 'object' ? meta.usage : null,
    rawText: String(meta.rawText || ''),
    strippedText: String(meta.strippedText || ''),
    parsedJson: meta.parsed && typeof meta.parsed === 'object' ? meta.parsed : null,
  };
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
    ...(theme && typeof theme === 'object' ? theme : {}),
    title: String(theme && theme.title || '').trim(),
    description: String(theme && theme.description || '').trim(),
    missions: Array.isArray(theme && theme.missions)
      ? theme.missions.map(normalizeMissionText).filter(Boolean).slice(0, missionCount)
      : [],
  };
}

function buildEmptyTheme(categories, walkMode) {
  return normalizeTheme({
    title: '',
    description: '',
    category: '组合',
    missions: [],
    vibeColor: '',
    combinedCategories: categories,
  }, walkMode);
}

function normalizeCategories(categories) {
  return (Array.isArray(categories) ? categories : [])
    .map((item) => String(item || '').replace(/漫步/g, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function pickFallbackPlace(locationSignals, nearbySummary) {
  return [
    nearbySummary.primaryAoiName,
    nearbySummary.aoiNames && nearbySummary.aoiNames[0],
    locationSignals.locationName,
  ].map((item) => String(item || '').trim())
    .find((item) => item && item !== '当前位置' && item !== '城市街道') || '这片地方';
}

function buildFallbackRuntimeContext(event) {
  return {
    locationSignals: normalizeLocationSignals(event),
    timeContext: normalizeTimeContext(event),
    nearbySummary: normalizeNearbySummary(event),
  };
}

function buildFallbackMissionPool(categories, event, preparedContext = null) {
  const prepared = preparedContext || buildFallbackRuntimeContext(event);
  const locationSignals = prepared.locationSignals || normalizeLocationSignals(event);
  const timeContext = prepared.timeContext || normalizeTimeContext(event);
  const nearbySummary = prepared.nearbySummary || normalizeNearbySummary(event);
  const place = pickFallbackPlace(locationSignals, nearbySummary);
  const phase = timeContext.timePhase || '此刻';
  const poiTypes = Array.isArray(nearbySummary.poiTypes) ? nearbySummary.poiTypes.filter(Boolean).slice(0, 3) : [];
  const typeText = poiTypes.length ? poiTypes.join('、') : '附近可见的东西';
  const skeletonGroups = buildTaskSkeletonGroups(categories, timeContext.timePhase, event.walkMode, {
    combined: true,
    event,
  });
  const skeletonMissions = []
    .concat(skeletonGroups.themeSkeletons || [])
    .concat(skeletonGroups.timeSkeletons || [])
    .map((item) => String(item || '').replace(/^[^：:]+[：:]/, '').trim())
    .filter(Boolean)
    .map((item) => `${item.replace(/这片地方/g, place).replace(/附近/g, place)}，参考${typeText}`);
  return [
    `在${place}找一个能同时带出${categories.join('和')}的细节`,
    `先看${categories[0]}，再判断它和${categories[1] || categories[0]}怎么叠在一起`,
    `${phase}里沿着${place}走几步，找${categories.join('、')}同时出现的一刻`,
  ].concat(skeletonMissions);
}

function ensureThemeMissions(theme, categories, event, preparedContext = null, reason = '') {
  const missionCount = event.walkMode === 'advanced' ? 3 : 1;
  const normalizedTheme = normalizeTheme(theme, event.walkMode);
  const missions = normalizedTheme.missions.slice();
  const fallbackPool = buildFallbackMissionPool(categories, event, preparedContext)
    .map((item) => compactMission(item, event.walkMode))
    .filter(Boolean);
  fallbackPool.forEach((mission) => {
    if (missions.length >= missionCount) {
      return;
    }
    if (!missions.some((existing) => missionsAreSimilar(existing, mission))) {
      missions.push(mission);
    }
  });
  while (missions.length < missionCount) {
    const index = missions.length + 1;
    missions.push(compactMission(`在${pickFallbackPlace(normalizeLocationSignals(event), normalizeNearbySummary(event))}找第${index}个同时带出${categories.join('和')}的线索`, event.walkMode));
  }
  return {
    ...normalizedTheme,
    title: normalizedTheme.title || `${categories.join('×')}观察`,
    description: normalizedTheme.description || '从当下附近可见线索开始。',
    category: '组合',
    missions: missions.slice(0, missionCount),
    fallbackMeta: {
      used: missions.length > normalizedTheme.missions.length || !!reason,
      reason,
    },
  };
}

function buildPrompt(event, categories, preparedContext = null) {
  const prepared = preparedContext || buildPreparedRuntimeContext(event, {
    categories,
    walkMode: event.walkMode,
    combined: true,
  });
  const locationSignals = prepared.locationSignals || normalizeLocationSignals(event);
  const timeContext = prepared.timeContext || normalizeTimeContext(event);
  const nearbySummary = prepared.nearbySummary || normalizeNearbySummary(event);
  const preferenceContext = prepared.preferenceContext || buildPreferenceContext(event);
  const promptContext = prepared.promptContext || buildPromptContextBlock(event, {
    categories,
    walkMode: event.walkMode,
    combined: true,
  });
  const generationContext = event && event.generationContext && typeof event.generationContext === 'object'
    ? event.generationContext
    : {};
  const contextPacket = generationContext.contextPacket && typeof generationContext.contextPacket === 'object'
    ? generationContext.contextPacket
    : {};
  const previousMissions = Array.isArray(contextPacket.generation && contextPacket.generation.previousMissions)
    ? contextPacket.generation.previousMissions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const missionCount = event.walkMode === 'advanced' ? 3 : 1;
  const generationRules = [
    '直接生成组合主题任务，不要输出生成过程说明。',
    `必须把主题 ${categories.join('、')} 融合在一起，不要拆成两段各写各的。`,
    '任务要短、具体、可执行，像真人会收到的任务卡片，不要写成散文。',
    '要体现当前时间段、漫步主题和 AOI 语境，不要机械重复地点名，不要让任务落到其他主题上。',
    '避免空话，例如“寻找一个细节”“感受一下周围”“观察这里的变化”。',
    '避免抽象大词堆砌，例如“氛围、气质、秩序、关系、张力”单独充当观察对象。',
    missionCount === 1 ? '只返回 1 条任务，尽量控制在 18 到 30 个字。' : '返回 3 条任务，每条尽量控制在 14 到 28 个字，三条任务要有明显差异。',
    '标题尽量在 12 个字以内，描述尽量在 32 个字以内。',
    '输出语言自然、具体、少 AI 味，不要解释为什么这样生成。',
    '结合 AOI 层级、AOI 类型、时间、主题和偏好自行选择合适对象，优先选择常见、可现场确认、不依赖具体地名就能完成的对象。禁止选择让人生理厌恶的对象，比如垃圾桶',
    '如果 previousMissions 非空，必须逐条避开上一轮任务，不要重复上一轮的对象、动作和句式。',
    '地点判断只参考 region、nearby.aoi、nearby.aoiList、nearby.aoiTypes 和 businessAreas；不要依赖 location.name、POI 具体名称或 POI 类型。',
    '好任务优先级：优先选近处、稳定、此刻容易找到的对象；去掉状语和不必要的动作指令，只保留核心动作',
    '如果任务里涉及人物或状态解读，可以基于当下听到或看到的线索做轻量判断，但不要写成需要长时间跟踪、偷拍偷录或下结论式审问的任务。',
    '每条任务必须是一句语义完整、自然收口的话，不能停在半截动作上。不要输出“找个……，停下”“在……旁，听……”这种没说完的句子；动作后面必须落到明确的观察对象、比较对象或判断目标。',
  ];
  const fixedProtocol = {
    outputContract: '只返回一个合法 JSON 对象，不要输出解释、前后缀、代码块。',
    rulePriority: '优先遵循 fixedProtocol.generationRules，其次参考 strategyInput.themeTaskSkeletons、strategyInput.timeTaskSkeletons 和 dynamicContext.preferenceGuide。',
    contextPriority: 'dynamicContext 是这次真正变化的现场信息，越靠后的内容越代表当下。',
    conflictPolicy: '如果规则之间冲突，优先保证主题融合自然、任务具体、句子完整。',
    generationRules,
  };
  const strategyInput = {
    walkMode: event.walkMode || 'advanced',
    categories,
    missionCount,
    themeTaskSkeletons: promptContext.themeSkeletonHints,
    timeTaskSkeletons: promptContext.timeSkeletonHints,
  };
  const dynamicContext = {
    mood: event.mood || '',
    weather: event.weather || '',
    season: event.season || '',
    preference: preferenceContext.preference || '',
    preferenceGuide: {
      instruction: preferenceContext.instruction,
    },
    region: locationSignals.locationRegion || '',
    time: {
      timePhase: timeContext.timePhase || '',
      timeHints: summarizeCoreTimeHints(timeContext),
    },
    nearby: {
      aoi: nearbySummary.primaryAoiName || nearbySummary.primaryAoiType || '',
      aoiList: nearbySummary.aoiNames,
      aoiTypes: (nearbySummary.aoiTypes || []),
      businessAreas: nearbySummary.businessAreaNames.slice(0, 2),
    },
    previousMissions,
  };

  return `你是“遛遛”小程序的城市漫步组合主题生成助手。请按固定协议、策略输入、动态上下文的顺序理解内容，并直接生成结果。

固定协议：
${JSON.stringify(fixedProtocol, null, 2)}

策略输入：
${JSON.stringify(strategyInput, null, 2)}

动态上下文：
${JSON.stringify(dynamicContext, null, 2)}

上下文摘要：
${promptContext.text}

返回 JSON：
{
  "title": "主题标题",
  "description": "简短描述",
  "category": "组合",
  "missions": ["任务1", "任务2", "任务3"],
  "vibeColor": "十六进制颜色"
}`;
}

exports.main = async (event) => {
  const categories = normalizeCategories(event.categories);
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
      source: 'combined-direct-error',
      structureCheck: summarizeStructureCheck(needTheme, event, {
        categories,
        combined: true,
      }),
      runtimeVersion: RUNTIME_VERSION,
      reason: 'need_two_categories',
    };
  }

  const preparedContext = buildPreparedRuntimeContext(event, {
    categories,
    walkMode: event.walkMode,
    combined: true,
    recentHistoryLimit: 10,
  });
  const prompt = buildPrompt(event, categories, preparedContext);
  const systemPrompt = '你是遛遛小程序的组合主题策划助手。只返回合法 JSON，不要输出额外解释。';
  const modelRequest = buildModelRequestDebug(systemPrompt, prompt);

  try {
    const aiResult = await chatJsonWithMeta(
      systemPrompt,
      prompt
    );
    const fallbackContext = buildFallbackRuntimeContext(event);
    const generatedTheme = ensureThemeMissions(aiResult.parsed, categories, event, fallbackContext, '');
    const modelResponse = buildModelResponseDebug(aiResult);
    const fallbackUsed = generatedTheme.fallbackMeta && generatedTheme.fallbackMeta.used;

    return {
      theme: generatedTheme,
      source: fallbackUsed ? 'combined-direct-partial-fallback' : 'combined-direct-raw',
      structureCheck: summarizeStructureCheck(generatedTheme, event, {
        categories,
        combined: true,
      }),
      runtimeVersion: RUNTIME_VERSION,
      combinedCategories: categories,
      modelRequest,
      modelResponse,
      reason: '',
    };
  } catch (error) {
    const modelResponse = buildModelResponseDebug(error);
    const fallbackContext = buildFallbackRuntimeContext(event);
    const fallbackTheme = ensureThemeMissions(buildEmptyTheme(categories, event.walkMode), categories, event, fallbackContext, error.message || 'generate_failed');
    return {
      theme: fallbackTheme,
      source: 'combined-direct-fallback',
      structureCheck: summarizeStructureCheck(fallbackTheme, event, {
        categories,
        combined: true,
      }),
      runtimeVersion: RUNTIME_VERSION,
      combinedCategories: categories,
      modelRequest,
      modelResponse,
      reason: error.message || 'generate_failed',
    };
  }
};

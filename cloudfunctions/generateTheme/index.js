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

const RUNTIME_VERSION = '2026-04-16-direct-ai-fallback-r12';

function buildModelRequestDebug(systemPrompt, userPrompt) {
  const config = getAiConfig();
  return {
    provider: 'dashscope-compatible',
    request: {
      model: config.model,
      temperature: 0.9,
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

function normalizeGeneratedTitle(title) {
  return String(title || '').trim();
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

function normalizeSelectedThemes(selectedThemes, event) {
  const limit = event && event.walkMode === 'pure' ? 1 : 2;
  return (Array.isArray(selectedThemes) ? selectedThemes : [])
    .map((item) => String(item || '').replace(/漫步/g, '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeTheme(theme, walkMode) {
  const missionCount = walkMode === 'advanced' ? 3 : 1;
  const missions = Array.isArray(theme && theme.missions)
    ? theme.missions.map(normalizeMissionText).filter(Boolean).slice(0, missionCount)
    : [];
  return {
    ...(theme && typeof theme === 'object' ? theme : {}),
    title: normalizeGeneratedTitle(theme && theme.title || ''),
    description: String(theme && theme.description || '').trim(),
    missions,
  };
}

function buildEmptyTheme(categories, walkMode) {
  return normalizeTheme({
    title: '',
    description: '',
    category: categories.length > 1 ? '组合' : (categories[0] || ''),
    missions: [],
    vibeColor: '',
  }, walkMode);
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
  const poiTypes = Array.isArray(nearbySummary.poiTypes) ? nearbySummary.poiTypes.filter(Boolean).slice(0, 3) : [];
  const typeText = poiTypes.length ? poiTypes.join('、') : '附近可见的东西';
  const phase = timeContext.timePhase || '此刻';
  const theme = categories[0] || '附近';
  const themePools = {
    形状: [
      `在${place}找一处最清楚的方圆、直弯或高低差别`,
      `看${place}里一组重复出现的形状，判断哪里最整齐`,
      `退后一步看${place}的入口、边角或框线，找最明显的形状`,
    ],
    色彩: [
      `在${place}找此刻最先跳出来的一块颜色`,
      `比较${place}里亮处和暗处的颜色差别`,
      `记下${place}最像${phase}的一组颜色搭配`,
    ],
    声音: [
      `在${place}停一下，听离你最近的一层声音从哪来`,
      `顺着${place}里一段持续的声音走几步`,
      `听${place}里${phase}最稳定的一种声音`,
    ],
    数字: [
      `在${place}找一个正在指引行动的数字`,
      `看${place}里一组编号怎样安排前后顺序`,
      `找${place}里重复出现的数字或序号`,
    ],
    气味: [
      `在${place}闻到一股味道后，判断它从哪边来`,
      `比较${place}前后两处气味是变浓还是变淡`,
      `等风经过${place}时，留意哪种味道先出现`,
    ],
  };
  const skeletonGroups = buildTaskSkeletonGroups(categories, timeContext.timePhase, event.walkMode, {
    combined: categories.length > 1,
    event,
  });
  const skeletonMissions = []
    .concat(skeletonGroups.themeSkeletons || [])
    .concat(skeletonGroups.timeSkeletons || [])
    .map((item) => String(item || '').replace(/^[^：:]+[：:]/, '').trim())
    .filter(Boolean)
    .map((item) => `${item.replace(/这片地方/g, place).replace(/附近/g, place)}，参考${typeText}`);
  if (categories.length > 1) {
    return [
      `在${place}找一个能同时带出${categories.join('和')}的细节`,
      `先看${categories[0]}，再判断它和${categories[1]}怎么叠在一起`,
      `沿着${place}走几步，找${categories.join('、')}同时出现的一刻`,
    ].concat(skeletonMissions);
  }
  return (themePools[theme] || [
    `在${place}找一个最适合${theme}主题的近处细节`,
    `围绕${place}走几步，找一处能代表${theme}的线索`,
    `停在${place}，看${phase}里最容易被注意到的${theme}线索`,
  ]).concat(skeletonMissions);
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
    missions.push(compactMission(`在${pickFallbackPlace(normalizeLocationSignals(event), normalizeNearbySummary(event))}找第${index}个可马上观察的${categories[0] || '附近'}线索`, event.walkMode));
  }
  return {
    ...normalizedTheme,
    title: normalizedTheme.title || `${categories[0] || '附近'}观察`,
    description: normalizedTheme.description || '从当下附近可见线索开始。',
    category: normalizedTheme.category || (categories.length > 1 ? '组合' : (categories[0] || '')),
    missions: missions.slice(0, missionCount),
    fallbackMeta: {
      used: missions.length > normalizedTheme.missions.length || !!reason,
      reason,
    },
  };
}

function buildDirectPrompt(event, categories, preparedContext = null) {
  const prepared = preparedContext || buildPreparedRuntimeContext(event, {
    categories,
    walkMode: event.walkMode,
    combined: categories.length > 1,
  });
  const locationSignals = prepared.locationSignals || normalizeLocationSignals(event);
  const timeContext = prepared.timeContext || normalizeTimeContext(event);
  const nearbySummary = prepared.nearbySummary || normalizeNearbySummary(event);
  const preferenceContext = prepared.preferenceContext || buildPreferenceContext(event);
  const promptContext = prepared.promptContext || buildPromptContextBlock(event, {
    categories,
    walkMode: event.walkMode,
    combined: categories.length > 1,
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
    '只依据当前输入直接生成，不要输出生成过程说明。',
    '所有输出都只围绕这 1 个主题。',
    '任务必须短、真、能执行，像真人会收到的观察任务，不要写成散文。',
    '要体现当前时间段、漫步主题和 AOI 语境，不要机械重复地点名，不要让任务落到其他主题上。',
    '避免空话，例如“寻找一个细节”“感受一下周围”“观察这里的变化”。',
    '避免抽象大词堆砌，例如“氛围、气质、秩序、关系、张力”单独充当观察对象。',
    missionCount === 1 ? '只返回 1 条任务，尽量控制在 18 到 30 个字。' : '返回 3 条任务，每条尽量控制在 14 到 28 个字，三条任务要有明显差异。',
    '标题尽量在 12 个字以内，描述尽量在 32 个字以内，不要带编号。',
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
    conflictPolicy: '如果规则之间冲突，优先保证主题准确、任务具体、句子完整。',
    generationRules,
  };
  const strategyInput = {
    walkMode: event.walkMode || 'pure',
    selectedThemes: categories,
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

  return `你是“遛遛”小程序的城市漫步任务生成助手。请按固定协议、策略输入、动态上下文的顺序理解内容，并直接生成结果。

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
  "category": "主题名",
  "missions": ["任务1", "任务2", "任务3"],
  "vibeColor": "十六进制颜色"
}`;
}

exports.main = async (event) => {
  const categories = normalizeSelectedThemes(event.selectedThemes, event);
  const preparedContext = buildPreparedRuntimeContext(event, {
    categories,
    walkMode: event.walkMode,
    combined: categories.length > 1,
    recentHistoryLimit: 10,
  });
  const prompt = buildDirectPrompt(event, categories, preparedContext);
  const systemPrompt = '你是遛遛小程序的城市漫步策划助手。只返回合法 JSON，不要输出额外解释。';
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
      source: fallbackUsed ? 'ai-direct-partial-fallback' : 'ai-direct-raw',
      structureCheck: summarizeStructureCheck(generatedTheme, event, {
        categories,
        combined: categories.length > 1,
      }),
      runtimeVersion: RUNTIME_VERSION,
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
      source: 'ai-direct-fallback',
      structureCheck: summarizeStructureCheck(fallbackTheme, event, {
        categories,
        combined: categories.length > 1,
      }),
      runtimeVersion: RUNTIME_VERSION,
      modelRequest,
      modelResponse,
      reason: error.message || 'generate_failed',
    };
  }
};

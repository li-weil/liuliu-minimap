const cloud = require('wx-server-sdk');
const { chatJsonWithMeta, getAiConfig } = require('./ai');
const {
  normalizeLocationSignals,
  normalizeTimeContext,
  summarizeCoreTimeHints,
  normalizeNearbySummary,
  buildPreferenceContext,
  normalizeRecentMissionHistory,
  buildPreparedRuntimeContext,
  buildPromptContextBlock,
  finalizeTheme,
  summarizeThemeValidation,
  chooseTaskPlaceLabel,
} = require('./runtime');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const RUNTIME_VERSION = '2026-04-14-combined-direct-ai-r5';

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

function normalizeCategories(categories) {
  return (Array.isArray(categories) ? categories : [])
    .map((item) => String(item || '').replace(/漫步/g, '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function buildFallbackTheme(event, categories, preparedContext = null) {
  const prepared = preparedContext || buildPreparedRuntimeContext(event, {
    categories,
    walkMode: event.walkMode,
    combined: true,
  });
  const locationSignals = prepared.locationSignals || normalizeLocationSignals(event);
  const timeContext = prepared.timeContext || normalizeTimeContext(event);
  const nearbySummary = prepared.nearbySummary || normalizeNearbySummary(event);
  const preferenceContext = prepared.preferenceContext || buildPreferenceContext(event);
  const sceneName = chooseTaskPlaceLabel(locationSignals, nearbySummary) || locationSignals.locationName || '这片街区';
  const timePhase = timeContext.timePhase || '此刻';
  const preferredObject = preferenceContext.objectHints[0] || '';
  return {
    title: `${categories.join('×')}漫步`,
    description: `${timePhase}里，把${categories.join('和')}放进${sceneName}的此刻。`,
    category: '组合',
    missions: event.walkMode === 'advanced'
      ? [
          `在${sceneName}${preferredObject ? `先看${preferredObject}，` : ''}找一处同时呼应${categories.join('和')}的细节`,
          `比较两处${preferredObject || '地方'}怎样分别带出${categories.join('和')}`,
        `停一下，看它们在这里是怎么碰到一起的`,
        ]
      : [`在${sceneName}${preferredObject ? `先看${preferredObject}，` : ''}找一处同时呼应${categories.join('和')}的细节`],
    vibeColor: '#7c6a94',
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
    '直接生成组合主题任务，不提及 RAG、知识库、检索或验证。',
    `必须把主题 ${categories.join('、')} 融合在一起，不要拆成两段各写各的。`,
    '任务要短、具体、可执行，像真人会收到的任务卡片，不要写成散文。',
    '要体现当前时间段和场景语境，但不要每条都机械重复地点名。',
    '避免空话，例如“寻找一个细节”“感受一下周围”“观察这里的变化”。',
    '避免抽象大词堆砌，例如“氛围、气质、秩序、关系、张力”单独充当观察对象。',
    missionCount === 1 ? '只返回 1 条任务，尽量控制在 18 到 30 个字。' : '返回 3 条任务，每条尽量控制在 14 到 28 个字，三条任务要有明显差异。',
    '标题尽量在 12 个字以内，描述尽量在 32 个字以内。',
    '输出语言自然、具体、少 AI 味，不要解释为什么这样生成。',
    '如果提供了偏好，优先从 preferenceGuide.availableObjects 里选观察对象；preferenceGuide.blockedObjects 里的对象不要主动写进任务。',
    '如果 previousMissions 非空，必须逐条避开上一轮任务；先检查 previousMissions 用了哪些 availableObjects 对象，这些对象在这次生成中禁用，除非 availableObjects 剩下对象数量不够。',
    'preferenceGuide.objectDetails 给出了当前更值得参考的对象摘要。优先选这些文本证据更具体的对象，不要只根据“命中/未命中”做模糊判断。',
    '输出前先静默检查对象与地点是否对应，如果拿不准 preferenceGuide.availableObjects 里的对象是否合适，退回 preferenceGuide.safeObjects 里的对象。',
    '高德原生分类名只作为内部上下文，不要把 nearby.poiTypes 这类分类名和 nearby.pois 具体名称直接写进标题、描述或任务；如果需要写地点，只写具体 AOI、商圈或自然说法。',
    '好任务优先级：优先选近处、稳定、此刻容易找到的对象；优先用“看、听、找、比、停一下、顺着走、记下”这类自然动作；一条任务尽量只做一件事。',
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
      availableObjects: preferenceContext.availableObjects,
      blockedObjects: preferenceContext.blockedObjects.slice(0, 4),
      safeObjects: preferenceContext.safeObjects,
      objectDetails: preferenceContext.objectDetails.slice(0, 3),
      instruction: preferenceContext.instruction,
    },
    location: {
      name: locationSignals.locationName || '当前位置',
      sceneTag: locationSignals.sceneTag || '',
    },
    time: {
      timePhase: timeContext.timePhase || '',
      timeHints: summarizeCoreTimeHints(timeContext),
    },
    nearby: {
      nearbyScene: nearbySummary.dominantScene || '',
      aoi: nearbySummary.primaryAoiName || nearbySummary.primaryAoiType || '',
      aoiList: nearbySummary.aoiNames.slice(0, 4),
      businessAreas: nearbySummary.businessAreaNames.slice(0, 2),
      poiTypes: nearbySummary.poiTypes.slice(0, 5),
      pois: nearbySummary.poiNames.slice(0, 3),
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
      source: 'combined-direct-fallback',
      validation: summarizeThemeValidation(needTheme, event, {
        categories,
        combined: true,
      }),
      runtimeVersion: RUNTIME_VERSION,
      ragPlan: null,
      ragDebug: null,
      ragModelInput: null,
      reason: 'need_two_categories',
    };
  }

  const preparedContext = buildPreparedRuntimeContext(event, {
    categories,
    walkMode: event.walkMode,
    combined: true,
    recentHistoryLimit: 10,
  });
  const fallbackTheme = normalizeTheme(buildFallbackTheme(event, categories, preparedContext), event.walkMode);
  const prompt = buildPrompt(event, categories, preparedContext);
  const systemPrompt = '你是遛遛小程序的组合主题策划助手。只返回合法 JSON，不要输出额外解释。';
  const modelRequest = buildModelRequestDebug(systemPrompt, prompt);

  try {
    const aiResult = await chatJsonWithMeta(
      systemPrompt,
      prompt
    );
    const generatedTheme = normalizeTheme(aiResult.parsed, event.walkMode);
    const modelResponse = buildModelResponseDebug(aiResult);
    const finalizedTheme = finalizeTheme({
      ...fallbackTheme,
      ...generatedTheme,
      category: '组合',
    }, event, fallbackTheme, {
      categories,
      combined: true,
      preferAnchoredFill: true,
    });

    return {
      theme: finalizedTheme,
      source: 'combined-direct',
      validation: summarizeThemeValidation(finalizedTheme, event, {
        categories,
        combined: true,
      }),
      runtimeVersion: RUNTIME_VERSION,
      combinedCategories: categories,
      ragPlan: null,
      ragDebug: null,
      ragModelInput: null,
      modelRequest,
      modelResponse,
      reason: '',
    };
  } catch (error) {
    const finalizedFallback = finalizeTheme(fallbackTheme, event, fallbackTheme, {
      categories,
      combined: true,
      preferAnchoredFill: true,
    });
    return {
      theme: finalizedFallback,
      source: 'combined-direct-fallback',
      validation: summarizeThemeValidation(finalizedFallback, event, {
        categories,
        combined: true,
      }),
      runtimeVersion: RUNTIME_VERSION,
      combinedCategories: categories,
      ragPlan: null,
      ragDebug: null,
      ragModelInput: null,
      modelRequest,
      reason: error.message || 'generate_failed',
    };
  }
};

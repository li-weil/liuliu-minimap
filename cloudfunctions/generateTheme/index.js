const cloud = require('wx-server-sdk');
const { chatJson } = require('./ai');
const { retrieveContext, buildFallbackTheme, buildPrompt, buildRagModelInput } = require('./rag');
const {
  finalizeTheme,
  normalizeLocationSignals,
  summarizeThemeValidation,
  buildSecondaryValidationPrompt,
} = require('./runtime');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const includeDebugContext = process.env.DEBUG_RAG_CONTEXT === 'true';
const RUNTIME_VERSION = '2026-04-13-validation-r2';

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
    description: (locationName) => `沿着 ${locationName || '这片街区'} 的街角与立面，寻找最能改变空间节奏的线条、弧度和轮廓。`,
    fallbackMissions: [
      '寻找一个最有存在感的弧度，并拍下它属于哪里',
      '找到一组重复出现的形状，比较它们的差异',
      '记录一处最能改变空间节奏的线条或轮廓',
    ],
  },
  色彩: {
    matcher: isColorMission,
    title: (locationName) => `${locationName || '这片街区'}的色彩漫步`,
    description: (locationName) => `在 ${locationName || '这片街区'} 的街景里寻找最能定义今日情绪的颜色、明暗和色彩关系。`,
    fallbackMissions: [
      '找到一处最能代表这片区域气质的颜色',
      '拍下一个和周围环境形成反差的色彩角落',
      '寻找一组自然出现的渐变色，并说出它像什么情绪',
    ],
  },
  声音: {
    matcher: isSoundMission,
    title: (locationName) => `${locationName || '这片街区'}的声音漫步`,
    description: (locationName) => `把 ${locationName || '这片街区'} 当作今天的声场，去捕捉持续、突然、远近交替的环境声音。`,
    fallbackMissions: [
      '找到一个能听见连续环境声的地方',
      '记录一段来自远处却影响你步伐的声音',
      '寻找一种有节奏的环境声，并写下它像什么',
    ],
  },
  数字: {
    matcher: isNumberMission,
    title: (locationName) => `${locationName || '这片街区'}的数字漫步`,
    description: (locationName) => `在 ${locationName || '这片街区'} 寻找像数字的形状、可数的数量、数字变体或行动密码。`,
    fallbackMissions: [
      '寻找一个像数字的街头形状，并说出它最像几',
      '在眼前画面里凑齐3个同类元素，拍下它们并数清数量',
      '找到一个数字变体或密码线索，如IV、三、Three或门牌号',
    ],
  },
  气味: {
    matcher: isSmellMission,
    title: (locationName) => `${locationName || '这片街区'}的气味漫步`,
    description: (locationName) => `顺着 ${locationName || '这片街区'} 的空气与热气流动，寻找最能代表当下天气和街区性格的味道。`,
    fallbackMissions: [
      '找到一处最有气味记忆的角落，并写下它像什么季节',
      '记录一阵突然靠近又散开的气味，猜它从哪里来',
      '寻找一种最能代表当下天气或街区的味道',
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
  const fallbackMissions = Array.isArray(fallbackTheme.missions) ? fallbackTheme.missions : [];
  const currentMissions = Array.isArray(theme.missions) ? theme.missions : [];
  const alignedMissions = currentMissions.filter(rule.matcher);

  const completedMissions = [...alignedMissions];
  fallbackMissions.forEach((mission) => {
    if (completedMissions.length < (event.walkMode === 'advanced' ? 3 : 1) && rule.matcher(mission)) {
      completedMissions.push(mission);
    }
  });

  while (completedMissions.length < (event.walkMode === 'advanced' ? 3 : 1)) {
    completedMissions.push(rule.fallbackMissions[completedMissions.length % rule.fallbackMissions.length]);
  }

  return {
    ...theme,
    category: onlyTheme,
    title: new RegExp(onlyTheme).test(theme.title || '') ? theme.title : rule.title(locationSignals.locationName),
    description: rule.matcher(theme.description || '')
      ? theme.description
      : rule.description(locationSignals.locationName),
    missions: completedMissions.slice(0, event.walkMode === 'advanced' ? 3 : 1),
  };
}

function normalizeAiValidationResult(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  return {
    stage: 'ai-review',
    ok: !!payload.ok,
    score: Number.isFinite(Number(payload.score)) ? Number(payload.score) : null,
    reasons: Array.isArray(payload.reasons) ? payload.reasons.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4) : [],
    shouldRewrite: !!payload.shouldRewrite,
    rewrittenTheme: payload.rewrittenTheme && typeof payload.rewrittenTheme === 'object' ? payload.rewrittenTheme : null,
  };
}

async function maybeRunSecondaryValidation(theme, event, fallbackTheme, options) {
  let validation = summarizeThemeValidation(theme, event, {
    ...options,
    allowSecondaryValidation: true,
  });
  if (!validation.shouldRunSecondaryValidation) {
    return { theme, validation };
  }

  try {
    const aiValidation = normalizeAiValidationResult(await chatJson(
      '你是遛遛小程序的主题质检助手。只返回合法 JSON，不要输出额外解释。',
      buildSecondaryValidationPrompt(theme, event, options)
    ));
    if (!aiValidation) {
      return { theme, validation };
    }
    let nextTheme = theme;
    if (aiValidation.shouldRewrite && aiValidation.rewrittenTheme) {
      const rewrittenTheme = normalizeTheme({
        ...theme,
        ...aiValidation.rewrittenTheme,
      }, event.walkMode);
      nextTheme = finalizeTheme({ ...theme, ...rewrittenTheme }, event, fallbackTheme, options);
      validation = summarizeThemeValidation(nextTheme, event, {
        ...options,
        allowSecondaryValidation: true,
      });
    }
    return {
      theme: nextTheme,
      validation: {
        ...validation,
        ok: validation.ok && aiValidation.ok !== false,
        stage: 'ai-review',
        aiOk: aiValidation.ok,
        aiScore: aiValidation.score,
        aiReasons: aiValidation.reasons,
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
    const finalizedTheme = finalizeTheme({ ...fallbackTheme, ...alignedTheme }, event, fallbackTheme, {
      categories: normalizeSelectedThemes(event.selectedThemes, event),
    });
    const reviewResult = await maybeRunSecondaryValidation(finalizedTheme, event, fallbackTheme, {
      categories: normalizeSelectedThemes(event.selectedThemes, event),
    });
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

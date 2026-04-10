const cloud = require('wx-server-sdk');
const { chatJson } = require('./ai');
const { missionTemplates, sceneProfiles } = require('./knowledge');
const {
  normalizeLocationSignals,
  normalizeTimeContext,
  normalizeNearbySummary,
  buildPromptContextBlock,
  finalizeTheme,
} = require('./runtime');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const RANDOM_CATEGORIES = ['形状漫步', '色彩漫步', '声音漫步', '数字漫步', '气味漫步'];

const CATEGORY_FALLBACKS = {
  形状漫步: {
    vibeColor: '#627b75',
    missions: [
      '寻找一个最有存在感的弧度，并拍下它属于哪里',
      '找到一组重复出现的形状，比较它们的差异',
      '记录一处最能改变空间节奏的线条或轮廓',
    ],
  },
  色彩漫步: {
    vibeColor: '#b96a55',
    missions: [
      '找到一处最能代表这片区域气质的颜色',
      '拍下一个和周围环境形成反差的色彩角落',
      '寻找一组自然出现的渐变色，并说出它像什么情绪',
    ],
  },
  声音漫步: {
    vibeColor: '#52708a',
    missions: [
      '找到一个能听见连续环境声的地方',
      '记录一段来自远处却影响你步伐的声音',
      '寻找一种有节奏的环境声，并写下它像什么',
    ],
  },
  数字漫步: {
    vibeColor: '#8c7356',
    missions: [
      '寻找一个像数字的街头形状，并说出它最像几',
      '在眼前画面里凑齐3个同类元素，拍下它们并数清数量',
      '找到一个数字变体或密码线索，如IV、三、Three或门牌号',
    ],
  },
  气味漫步: {
    vibeColor: '#8a6a52',
    missions: [
      '找到一处最有气味记忆的角落，并写下它像什么季节',
      '记录一阵突然靠近又散开的气味，猜它从哪里来',
      '寻找一种最能代表当下天气或街区的味道',
    ],
  },
};

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

function findRelatedScenes(event) {
  const timeContext = normalizeTimeContext(event);
  const nearbySummary = normalizeNearbySummary(event);
  const locationSignals = normalizeLocationSignals(event);
  const tokens = [
    locationSignals.locationName,
    locationSignals.locationContext,
    locationSignals.sceneTag,
    event.preference,
    event.weather,
    event.season,
    event.mood,
    timeContext.timePhase,
    timeContext.weekdayType,
    timeContext.timeHints.join(' '),
    nearbySummary.dominantScene,
    nearbySummary.poiNames.join(' '),
    nearbySummary.poiTypes.join(' '),
    nearbySummary.activityHints.join(' '),
  ]
    .filter(Boolean)
    .join(' ');
  return sceneProfiles.filter((scene) => scene.keywords.some((keyword) => tokens.includes(keyword)));
}

function getCategoryCore(category) {
  return String(category || '').replace(/漫步/g, '').trim();
}

function buildReferenceContext(category, event) {
  const core = getCategoryCore(category);
  const relatedTemplates = shuffle(missionTemplates.filter((item) => item.category === core)).slice(0, 2);
  const relatedScenes = shuffle(findRelatedScenes(event)).slice(0, 3);

  return {
    theme: core,
    scenes: relatedScenes.map((scene) => ({
      labels: scene.labels,
      missionHints: shuffle(scene.missionHints).slice(0, 4),
    })),
    templates: relatedTemplates.map((template) => ({
      cues: shuffle(template.cues).slice(0, 4),
      samples: shuffle(template.templates).slice(0, event.walkMode === 'advanced' ? 3 : 2),
    })),
  };
}

exports.main = async (event) => {
  const category = event.category || RANDOM_CATEGORIES[Math.floor(Math.random() * RANDOM_CATEGORIES.length)];
  const categoryFallback = CATEGORY_FALLBACKS[category] || CATEGORY_FALLBACKS.形状漫步;
  const referenceContext = buildReferenceContext(category, event);
  const locationSignals = normalizeLocationSignals(event);
  const promptContext = buildPromptContextBlock(event, {
    categories: [category],
    walkMode: event.walkMode,
  });
  const fallbackTheme = normalizeTheme({
    title: `${promptContext.timeContext.timePhase ? `${promptContext.timeContext.timePhase}的` : ''}${category}`,
    description: `在 ${locationSignals.locationContext || locationSignals.locationName || '这片地点'} 找到更贴近此刻的线索。`,
    category,
    missions: event.walkMode === 'advanced'
      ? categoryFallback.missions
      : [categoryFallback.missions[0]],
    vibeColor: categoryFallback.vibeColor,
  }, event.walkMode);

  const prompt = `请为微信小程序“遛遛”生成一个随机 City Walk 主题。
方向：${category}
${promptContext.text}
模式：${event.walkMode === 'advanced' ? '进阶模式，生成3个短而清楚的任务' : '纯粹模式，生成1个短而清楚的任务'}

以下是随机生成可参考的本地知识上下文：
${JSON.stringify(referenceContext, null, 2)}

要求：
1. 保持随机感，但不要空泛；要像“只有这片地点、这个时刻”才会成立的主题。
2. 优先借用参考线索与任务样例的结构，再改写成更在地、更有变化的新任务。
3. 三个任务切入角度尽量不同，不要只是同一句式改写。
4. 如果方向是“数字漫步”，所有任务都必须和数字形状联想、数量统计、数字变体识别或数字行动线索直接相关，不能偏到声音、色彩等无关主题。
5. 如果方向是“气味漫步”，所有任务都必须和气味、来源、气味记忆直接相关。
6. 如果方向是“声音漫步”，重点要放在听见、分辨、层次、节奏与空间关系。
7. 如果方向是“形状漫步”，重点要放在线条、轮廓、弧度、重复与几何关系。
8. 如果方向是“色彩漫步”，重点要放在色块、对比、渐变、明暗和环境色调。
9. 任务必须安全、可执行，不要进入受限区域。
10. 语言要像真实任务，不要写成散文，不要堆砌抽象修辞。
11. title 尽量控制在 12 个字以内，description 尽量控制在 32 个字以内。
12. 如果是纯粹模式，唯一的那个任务必须是“动作 + 观察重点”的一句话，尽量控制在 32 个字以内，不要写成长段落。
13. 如果提供了附近 POI 或活动线索，至少有一个任务要能看出这些附近信息。

返回 JSON：title, description, category, missions, vibeColor。`;

  try {
    const theme = normalizeTheme(await chatJson('你是遛遛小程序的随机主题策划助手。只返回合法 JSON。', prompt), event.walkMode);
    return {
      theme: finalizeTheme({ ...fallbackTheme, ...theme, category }, event, fallbackTheme, {
        categories: [category],
      }),
      source: 'random+ai',
      randomCategory: category,
    };
  } catch (error) {
    return {
      theme: finalizeTheme(fallbackTheme, event, fallbackTheme, {
        categories: [category],
      }),
      source: 'random-fallback',
      randomCategory: category,
      reason: error.message || 'generate_failed',
    };
  }
};

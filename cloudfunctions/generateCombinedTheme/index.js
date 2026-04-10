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

function buildSceneContext(event) {
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
  return shuffle(sceneProfiles.filter((scene) => scene.keywords.some((keyword) => tokens.includes(keyword)))).slice(0, 3);
}

function buildTemplateContext(categories, walkMode) {
  return categories.map((category) => ({
    category,
    references: shuffle(missionTemplates.filter((template) => template.category === category)).slice(0, 2).map((template) => ({
      cues: shuffle(template.cues).slice(0, 4),
      samples: shuffle(template.templates).slice(0, walkMode === 'advanced' ? 3 : 2),
    })),
  }));
}

exports.main = async (event) => {
  const categories = Array.isArray(event.categories) ? event.categories.filter(Boolean).slice(0, 3) : [];
  if (event.walkMode === 'pure') {
    return {
      theme: {
        title: '纯粹探索',
        description: '纯粹模式只允许选择一个主题方向。',
        category: categories[0] || '探索',
        missions: ['请选择一个主题后重新生成'],
        vibeColor: '#5a5a40',
      },
      source: 'combined-fallback',
      reason: 'pure_mode_single_theme_only',
    };
  }
  if (categories.length < 2) {
    return {
      theme: {
        title: '组合探索',
        description: '至少选择两个主题方向再进行组合。',
        category: '组合',
        missions: ['选择两个方向后再次生成'],
        vibeColor: '#7c6a94',
      },
      source: 'combined-fallback',
      reason: 'need_two_categories',
    };
  }

  const sceneContext = buildSceneContext(event);
  const templateContext = buildTemplateContext(categories, event.walkMode);
  const locationSignals = normalizeLocationSignals(event);
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

以下是组合生成的本地知识上下文：
${JSON.stringify({
  scenes: sceneContext.map((scene) => ({
    labels: scene.labels,
    missionHints: shuffle(scene.missionHints).slice(0, 4),
  })),
  themes: templateContext,
}, null, 2)}

要求：
1. 请创建一个真正融合这些方向的主题，而不是简单并列。
2. 三个任务切入角度尽量不同，可以分别从主体、关系、空间、时间、对比、来源、变化等角度切入。
3. 任务必须只围绕这两个方向展开，不要额外引入第三种无关主题。
4. 如果没有选择“声音”，就不要把声音当任务重点。
5. 如果包含“数字”，至少有一个任务必须直接涉及数字形状、数量统计、数字变体或数字行动线索。
6. 如果包含“气味”，至少有一个任务必须直接涉及气味来源、扩散、停留或气味记忆。
7. 如果包含“形状”，至少有一个任务必须直接涉及线条、轮廓、弧度或几何关系。
8. 如果包含“色彩”，至少有一个任务必须直接涉及色块、对比、渐变、明暗或环境色调。
9. 任务要具体、宽松、具有趣味，并且带有明确地点感和时间感。
10. 任务必须安全、可执行，不要进入受限区域。
11. 语言要像真实任务，不要写成散文，不要堆砌抽象修辞。
12. title 尽量控制在 12 个字以内，description 尽量控制在 32 个字以内。
13. 如果是纯粹模式，唯一的那个任务必须同时体现已选方向，并写成“动作 + 观察重点”的一句话，尽量控制在 32 个字以内。
14. 如果提供了附近 POI 或活动线索，至少有一个任务要能呼应这些附近信息。

返回 JSON：title, description, category, missions, vibeColor。`;

  try {
    const theme = normalizeTheme(await chatJson('你是遛遛小程序的组合主题策划助手。只返回合法 JSON。', prompt), event.walkMode);
    const enrichedTheme = event.walkMode === 'pure'
      ? {
          ...theme,
          missions: [enrichPureMissionText((theme.missions || [])[0], categories)],
        }
      : theme;
    return {
      theme: finalizeTheme({ ...fallbackTheme, ...enrichedTheme, category: '组合' }, event, fallbackTheme, {
        categories,
        combined: true,
      }),
      source: 'combined+ai',
      combinedCategories: categories,
    };
  } catch (error) {
    return {
      theme: finalizeTheme(fallbackTheme, event, fallbackTheme, {
        categories,
        combined: true,
      }),
      source: 'combined-fallback',
      combinedCategories: categories,
      reason: error.message || 'generate_failed',
    };
  }
};

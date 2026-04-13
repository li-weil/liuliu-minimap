const { THEME_CATEGORIES, missionTemplates, preferenceBias, sceneProfiles } = require('./knowledge');
const {
  normalizeLocationSignals,
  normalizeTimeContext,
  normalizeNearbySummary,
  normalizeCategoryList,
  buildPromptContextBlock,
} = require('./runtime');
const { buildUnifiedRetrievalContext } = require('./rag-runtime');

function shuffle(list) {
  const copied = [...list];
  for (let index = copied.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copied[index], copied[swapIndex]] = [copied[swapIndex], copied[index]];
  }
  return copied;
}

function pickOne(list, fallback) {
  if (!list || !list.length) {
    return fallback;
  }
  return list[Math.floor(Math.random() * list.length)];
}

function tokenize(parts) {
  return parts
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .split(/[\s,，。；;、/|]+/)
    .filter(Boolean);
}

function normalizeSelectedThemes(selectedThemes, event) {
  const limit = event && event.walkMode === 'pure' ? 1 : 2;
  const directThemes = normalizeCategoryList(selectedThemes);
  if (directThemes.length) {
    return directThemes.slice(0, limit);
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
  return normalizeCategoryList(packetThemes).slice(0, limit);
}

function scoreScene(scene, tokens, preference) {
  let score = 0;
  scene.keywords.forEach((keyword) => {
    if (tokens.some((token) => token.includes(keyword) || keyword.includes(token))) {
      score += 3;
    }
  });

  const bias = preferenceBias[preference] || [];
  if (bias.includes(scene.id)) {
    score += 2;
  }

  return score;
}

function chooseCategories(event, topScene, selectedThemes) {
  if (selectedThemes.length) {
    const categories = selectedThemes.filter((item) => THEME_CATEGORIES.includes(item));
    if (categories.length < 3 && topScene) {
      topScene.categories.forEach((category) => {
        if (THEME_CATEGORIES.includes(category) && !categories.includes(category) && categories.length < 3) {
          categories.push(category);
        }
      });
    }
    return categories.slice(0, 3);
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
    topScene.categories.forEach((category) => {
      if (THEME_CATEGORIES.includes(category)) {
        categories.add(category);
      }
    });
  }

  return Array.from(categories).slice(0, 3);
}

function retrieveContext(event) {
  return buildUnifiedRetrievalContext(event, {
    selectedThemes: normalizeSelectedThemes(event.selectedThemes, event),
    missionTemplates,
    sceneProfiles,
    themeCategories: THEME_CATEGORIES,
    preferenceBias,
  });
}

function buildFallbackTheme(event, ragContext) {
  const locationSignals = normalizeLocationSignals(event);
  const missionsNeeded = event.walkMode === 'advanced' ? 3 : 1;
  const missionPool = shuffle(ragContext.referenceMissions.flatMap((item) => item.samples));
  const missions = missionPool.slice(0, missionsNeeded);
  const primaryCategory = pickOne(ragContext.selectedThemes, pickOne(ragContext.categories, '探索'));
  const leadScene = pickOne(ragContext.scenes, null);
  const sceneLabel = leadScene ? leadScene.labels.join(' / ') : '城市街道';
  const timeLabel = ragContext.timeContext && ragContext.timeContext.timePhase ? ragContext.timeContext.timePhase : '';
  const primaryAnchor = ragContext.generationPlan && Array.isArray(ragContext.generationPlan.primaryAnchors)
    ? ragContext.generationPlan.primaryAnchors[0]
    : '';
  const titleTemplates = [
    `${timeLabel ? `${timeLabel}的` : ''}${primaryCategory}漫步`,
    `${locationSignals.locationName || '这片街区'}的${primaryCategory}`,
    `${primaryCategory}观察：${locationSignals.locationName || '身边角落'}`,
  ];
  const descriptionTemplates = [
    `${timeLabel ? `${timeLabel}里，` : ''}围绕 ${sceneLabel} 留意最贴近此刻的细节。`,
    `顺着 ${sceneLabel} 的气质，找出今天这片地方最具体的线索。`,
    `把 ${sceneLabel} 当作入口，在熟悉街区里重新看见附近。`,
    primaryAnchor ? `从 ${primaryAnchor} 这样的附近线索切进去，找到这片地方此刻最具体的入口。` : '',
  ];
  const vibeColors = {
    声音: ['#52708a', '#4d6b78', '#648692'],
    色彩: ['#b96a55', '#6b7c59', '#906f4f'],
    形状: ['#5e6f86', '#627b75', '#7c6a94'],
    数字: ['#8c7356', '#9a7f61', '#7d6a52'],
    气味: ['#8a6a52', '#7a614f', '#9b785b'],
    探索: ['#5a5a40', '#6f6a5f', '#52708a'],
  };

  return {
    title: pickOne(titleTemplates, `${locationSignals.locationName || '城市一角'}的${primaryCategory}漫步`),
    description: pickOne(descriptionTemplates, `围绕 ${sceneLabel} 展开一场更贴近在地细节的城市观察。`),
    category: primaryCategory,
    missions: missions.length ? missions : ['寻找一个让你驻足的细节'],
    vibeColor: pickOne(vibeColors[primaryCategory], '#5a5a40'),
  };
}

function buildPlanDigest(ragContext) {
  const plan = ragContext && ragContext.generationPlan ? ragContext.generationPlan : {};
  const debug = ragContext && ragContext.ragDebug ? ragContext.ragDebug : {};
  return {
    targetThemes: Array.isArray(plan.targetThemes) ? plan.targetThemes : [],
    chosenScene: plan.chosenScene || '',
    primaryAnchors: Array.isArray(plan.primaryAnchors) ? plan.primaryAnchors : [],
    recommendedAngles: Array.isArray(plan.recommendedAngles) ? plan.recommendedAngles : [],
    antiPatterns: Array.isArray(plan.antiPatterns) ? plan.antiPatterns : [],
    supportingScenes: Array.isArray(plan.supportingScenes) ? plan.supportingScenes : [],
    sceneCoverage: Array.isArray(debug.sceneCoverage) ? debug.sceneCoverage : [],
  };
}

function buildRagModelInput(ragContext) {
  const context = ragContext && typeof ragContext === 'object' ? ragContext : {};
  return {
    selectedThemes: Array.isArray(context.selectedThemes) ? context.selectedThemes : [],
    requestedCategories: Array.isArray(context.requestedCategories) ? context.requestedCategories : [],
    locationContext: context.locationContext || '',
    sceneTag: context.sceneTag || '',
    timeContext: context.timeContext || {},
    nearbySummary: context.nearbySummary || {},
    scenes: Array.isArray(context.scenes) ? context.scenes : [],
    categories: Array.isArray(context.categories) ? context.categories : [],
    referenceMissions: (Array.isArray(context.referenceMissions) ? context.referenceMissions : [])
      .map((item) => ({
        id: item.id,
        category: item.category,
        angle: item.angle,
        cues: item.cues,
        sceneFit: item.sceneFit,
        timeFit: item.timeFit,
        anchorTypes: item.anchorTypes,
        antiPatterns: item.antiPatterns,
        diversityTags: item.diversityTags,
        retrievalScore: item.retrievalScore,
        scoreBreakdown: item.scoreBreakdown,
      })),
    generationIntent: context.generationIntent || {},
    generationPlan: context.generationPlan || {},
    ragDebug: context.ragDebug || {},
    note: '已移除知识库样例原句，模型只能参考角度、线索和锚点，不应照抄样例句。',
  };
}

function buildPrompt(event, ragContext) {
  const selectedThemes = normalizeSelectedThemes(event.selectedThemes, event);
  const locationSignals = normalizeLocationSignals(event);
  const generationContext = event && event.generationContext && typeof event.generationContext === 'object'
    ? event.generationContext
    : {};
  const contextPacket = generationContext.contextPacket && typeof generationContext.contextPacket === 'object'
    ? generationContext.contextPacket
    : {};
  const generationSeed = event.generationSeed
    || generationContext.generationSeed
    || (contextPacket.generation && contextPacket.generation.seed)
    || '';
  const promptContext = buildPromptContextBlock(event, {
    categories: selectedThemes.length ? selectedThemes : ragContext.categories,
    walkMode: event.walkMode,
  });
  const planDigest = buildPlanDigest(ragContext);
  const ragModelInput = buildRagModelInput(ragContext);
  const modeInstruction = event.walkMode === 'advanced'
    ? '生成 3 个短而清楚的任务，每条尽量控制在 16 到 28 个字。'
    : '只生成 1 个短而清楚的任务，优先写成“动作 + 观察重点”的一句话，尽量控制在 32 个字以内，不要写成长段落。';
  const selectedThemeLine = selectedThemes.length
    ? `- 主题偏向: ${selectedThemes.join('、')}`
    : '- 主题偏向: 无，允许自由发挥';
  const strictThemeScopeLine = selectedThemes.length === 1
    ? `- 严格主题范围: 当前只允许围绕“${selectedThemes[0]}”展开，不能扩展到未选主题`
    : selectedThemes.length === 2
      ? `- 严格主题范围: 当前只允许围绕“${selectedThemes.join('、')}”展开，不要加入第三种无关主题`
      : '- 严格主题范围: 可在检索上下文里自由平衡';
  const themeTraceRequirementLine = !selectedThemes.length
    ? '3. 如果用户没有指定主题偏向，可以在检索上下文里自由平衡，但任务仍要保持明确方向。'
    : event.walkMode === 'advanced'
      ? (selectedThemes.length === 2
        ? '3. 如果用户选了 2 个主题偏向，至少有 2 个任务要能直接看出这两个主题偏向的痕迹。'
        : '3. 如果用户选了 1 个主题偏向，至少有 2 个任务要能直接看出这个主题偏向的痕迹。')
      : '3. 如果用户选了主题偏向，唯一任务必须直接体现这个主题方向。';

  return `你正在为微信小程序“遛遛”生成一次城市漫步主题。

用户输入：
- 心情: ${event.mood}
- 天气: ${event.weather}
- 季节: ${event.season}
- 偏好: ${event.preference}
- 地点: ${locationSignals.locationName || event.locationName}
${selectedThemeLine}
${strictThemeScopeLine}
- 本次变化种子: ${generationSeed || '未提供'}
- 生成上下文:
${promptContext.text}

以下是检索增强上下文（RAG），请优先基于这些信息生成，而不是凭空想象：
${JSON.stringify(ragModelInput, null, 2)}

以下是这次生成必须显式消费的 RAG 计划：
${JSON.stringify({
  targetThemes: planDigest.targetThemes,
  chosenScene: planDigest.chosenScene,
  supportingScenes: planDigest.supportingScenes,
  primaryAnchors: planDigest.primaryAnchors,
  recommendedAngles: planDigest.recommendedAngles,
  antiPatterns: planDigest.antiPatterns,
  sceneCoverage: planDigest.sceneCoverage.slice(0, 3),
}, null, 2)}

生成要求：
1. 主题必须明显体现地点语境、时间段和附近场景，优先写“此时此地”而不是泛化概念。
2. 如果用户给了主题偏向，标题、描述和任务都必须明显朝这些主题偏向靠拢，不能忽略不管。
${themeTraceRequirementLine}
4. category 优先从用户选择的主题偏向里选，如果没有再从 RAG 推断。
5. 如果用户没有选择“声音”，就不要把“听声、记录声音、像什么节奏”作为任务重点。
6. 如果用户没有选择“数字”，就不要把“数清、数量、编号、门牌、楼层、票号、出口号”作为任务核心动作；这些只属于数字主题。
7. 如果用户没有选择“色彩”，就不要把“颜色、色块、冷暖色、反光、色温”作为任务核心动作；这些只属于色彩主题。
8. 如果用户没有选择“气味”，就不要把“闻一闻、味道、香气、热气、潮气”作为任务核心动作；这些只属于气味主题。
9. 如果用户选择了“形状”，任务必须围绕轮廓、线条、弧度、边界、门洞、窗框、几何关系或临时形状，不要写成数量统计；允许借光影帮助看清轮廓，但重点仍然是形状本身。
10. 如果用户选择了“色彩”，任务必须围绕色块、配色、明暗、反光、色温、渐变或环境色调，不要写成单纯听声或数数。
11. 如果用户选择了“声音”，任务必须围绕声音来源、远近层次、持续与突发、回响、提示音或生活节奏，不要写成纯颜色观察。
12. 如果用户选择了“数字”，优先围绕数字形状联想、数量统计、数字的另一种写法、或数字行动线索来设计任务，而不是随意转成别的感官维度；允许出现“像数字的形状”，但重点必须落在数字判断。
13. 如果用户选择了“气味”，任务必须围绕来源、扩散、停留、冷热交界、食物香、草木味、清洁味或潮气，不要写成纯色彩或数量任务。
14. 任务要鼓励观察形状、色彩、声音、数字、气味这些主题相关的在地细节，但必须服从用户选定的主题范围。
15. 任务应安全、可执行，不要引导危险行为或进入受限区域。
16. 语言要像真实任务，不要散文腔，不要堆砌抽象修辞，不要写成任何城市都适用的空话。${modeInstruction}
17. 优先使用 RAG、时间线索、附近摘要提供的信息进行改写、组合、在地化。
18. 如果用户只选了一个主题，例如“数字”，所有任务都必须和这个主题直接相关；不允许出现完全无关的声音、气味、色彩等支线任务。
19. 如果用户只选了“数字”，任务必须直接涉及：像数字的形状、数量统计、罗马数字/汉字/英文等数字变体、门牌号/步数/密码等数字行动线索，不能写成纯声音观察。
20. 三个任务的切入角度尽量不同，不要只是同一句式的轻微改写；可以分别从主体、关系、空间、时间、对比、来源、变化等不同角度切入。
21. 如果提供了附近 POI 或活动线索，至少有一个任务要能明确呼应这些附近信息。
22. 优先生成“这片地点此刻才能成立”的任务，特别要拉开清晨、黄昏、夜间、凌晨之间的差异。
23. title 尽量控制在 12 个字以内，description 尽量控制在 32 个字以内，description 不要重复任务内容。
24. 请优先使用 RAG 计划里的 primaryAnchors 和 recommendedAngles，至少让一个任务明确落在其中一个 anchor 上。
25. 如果是进阶模式，三个任务尽量分别从不同 angle 出发，不要让三个任务只是措辞不同。
26. 避开 antiPatterns，不要把任务写成泛泛的散文或任何城市都能成立的空句。
27. 同一地点重复生成时，请根据“本次变化种子”改变任务的动作、锚点或观察角度；不要反复使用“数一数 + 并列/两层/来源”这类固定句式。
28. RAG 只提供结构、角度、线索和锚点；不要复用知识库样例句，不要把 referenceMissions 当成可直接粘贴的任务文本。

返回 JSON：
{
  "title": "主题标题",
  "description": "32字以内的简短描述",
  "category": "形状/色彩/声音/数字/气味",
  "missions": ["任务 1", "任务 2", "任务 3"],
  "vibeColor": "十六进制颜色"
}`;
}

module.exports = {
  retrieveContext,
  buildFallbackTheme,
  buildPrompt,
  buildRagModelInput,
};

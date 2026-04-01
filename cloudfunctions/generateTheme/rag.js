const { THEME_CATEGORIES, missionTemplates, preferenceBias, sceneProfiles } = require('./knowledge');

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

function normalizeSelectedThemes(selectedThemes) {
  return (Array.isArray(selectedThemes) ? selectedThemes : [])
    .map((item) => String(item || '').replace(/漫步/g, '').trim())
    .filter(Boolean);
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

function chooseCategories(event, topScene) {
  const selectedThemes = normalizeSelectedThemes(event.selectedThemes);
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
    categories.add('动物');
    categories.add('气味');
    categories.add('声音');
  }

  if (event.preference === '人文历史') {
    categories.add('形状');
    categories.add('色彩');
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
  const selectedThemes = normalizeSelectedThemes(event.selectedThemes);
  const tokens = tokenize([
    event.locationName,
    event.locationContext,
    event.preference,
    event.weather,
    event.mood,
    event.season,
    selectedThemes.join(' '),
  ]);

  const rankedScenes = sceneProfiles
    .map((scene) => ({ scene, score: scoreScene(scene, tokens, event.preference) }))
    .sort((left, right) => right.score - left.score);

  const topScenes = rankedScenes.filter((item) => item.score > 0).slice(0, 4).map((item) => item.scene);
  const fallbackScenes = topScenes.length ? topScenes : [sceneProfiles[0]];
  const categories = shuffle(chooseCategories(event, fallbackScenes[0])).slice(0, 3);

  const retrievedTemplates = shuffle(missionTemplates)
    .filter((template) => categories.includes(template.category))
    .slice(0, 6);

  const referenceMissions = retrievedTemplates.map((template) => ({
    category: template.category,
    cues: shuffle(template.cues).slice(0, 3),
    samples: shuffle(template.templates).slice(0, event.walkMode === 'advanced' ? 3 : 2),
  }));

  return {
    selectedThemes,
    scenes: shuffle(fallbackScenes).slice(0, 3).map((scene) => ({
      id: scene.id,
      labels: scene.labels,
      missionHints: shuffle(scene.missionHints).slice(0, 4),
      categories: scene.categories,
    })),
    categories,
    referenceMissions,
  };
}

function buildFallbackTheme(event, ragContext) {
  const missionsNeeded = event.walkMode === 'advanced' ? 3 : 1;
  const missionPool = shuffle(ragContext.referenceMissions.flatMap((item) => item.samples));
  const missions = missionPool.slice(0, missionsNeeded);
  const primaryCategory = pickOne(ragContext.selectedThemes, pickOne(ragContext.categories, '探索'));
  const leadScene = pickOne(ragContext.scenes, null);
  const sceneLabel = leadScene ? leadScene.labels.join(' / ') : '城市街道';
  const titleTemplates = [
    `${event.locationName || '城市一角'}的${primaryCategory}漫步`,
    `${event.locationName || '这片街区'}观察练习：${primaryCategory}`,
    `${primaryCategory}散策：重新看见${event.locationName || '身边角落'}`,
  ];
  const descriptionTemplates = [
    `围绕 ${sceneLabel} 展开一场更贴近在地细节的城市观察。`,
    `请沿着 ${sceneLabel} 的气质慢慢走，用更具体的目光捕捉今日线索。`,
    `把 ${sceneLabel} 当作今天的提示词，在熟悉街区里寻找新的感官入口。`,
  ];
  const vibeColors = {
    '声音': ['#52708a', '#4d6b78', '#648692'],
    '色彩': ['#b96a55', '#6b7c59', '#906f4f'],
    '形状': ['#5e6f86', '#627b75', '#7c6a94'],
    '动物': ['#7a8764', '#6b7c59', '#8a8f64'],
    '气味': ['#8a6a52', '#7a614f', '#9b785b'],
    '探索': ['#5a5a40', '#6f6a5f', '#52708a'],
  };

  return {
    title: pickOne(titleTemplates, `${event.locationName || '城市一角'}的${primaryCategory}漫步`),
    description: pickOne(descriptionTemplates, `围绕 ${sceneLabel} 展开一场更贴近在地细节的城市观察。`),
    category: primaryCategory,
    missions: missions.length ? missions : ['寻找一个让你驻足的细节'],
    vibeColor: pickOne(vibeColors[primaryCategory], '#5a5a40'),
  };
}

function buildPrompt(event, ragContext) {
  const modeInstruction = event.walkMode === 'advanced'
    ? '生成 3 个具体但不过度复杂的任务。'
    : '只生成 1 个完整而有层次的复合任务，任务句子要更丰富，包含主体、动作、观察重点或比较维度，不能只是一个过短的提示词。';
  const selectedThemes = normalizeSelectedThemes(event.selectedThemes);
  const selectedThemeLine = selectedThemes.length
    ? `- 主题偏向: ${selectedThemes.join('、')}`
    : '- 主题偏向: 无，允许自由发挥';
  const strictThemeScopeLine = selectedThemes.length === 1
    ? `- 严格主题范围: 当前只允许围绕“${selectedThemes[0]}”展开，不能扩展到未选主题`
    : selectedThemes.length === 2
      ? `- 严格主题范围: 当前只允许围绕“${selectedThemes.join('、')}”展开，不要加入第三种无关主题`
      : '- 严格主题范围: 可在检索上下文里自由平衡';

  return `你正在为微信小程序“遛遛”生成一次城市漫步主题。

用户输入：
- 心情: ${event.mood}
- 天气: ${event.weather}
- 季节: ${event.season}
- 偏好: ${event.preference}
- 地点: ${event.locationName}
- 地点语境: ${event.locationContext}
${selectedThemeLine}
${strictThemeScopeLine}

以下是检索增强上下文（RAG），请优先基于这些信息生成，而不是凭空想象：
${JSON.stringify(ragContext, null, 2)}

生成要求：
1. 主题必须明显体现地点语境和检索到的场景特征。
2. 如果用户给了主题偏向，标题、描述和任务都必须明显朝这些主题偏向靠拢，不能忽略不管。
3. 如果用户选了 1 到 2 个主题偏向，至少有 2 个任务要能直接看出这些主题偏向的痕迹。
4. category 优先从用户选择的主题偏向里选，如果没有再从 RAG 推断。
5. 如果用户没有选择“声音”，就不要把“听声、记录声音、像什么节奏”作为任务重点。
6. 如果用户选择了“动物”，优先围绕真实动物、动物痕迹、动物轮廓联想来设计任务，而不是随意转成别的感官维度。
7. 任务要鼓励观察形状、色彩、声音、动物、气味这些主题相关的在地细节，但必须服从用户选定的主题范围。
8. 任务应安全、可执行，不要引导危险行为或进入受限区域。
9. 避免过度抽象和重复表达。${modeInstruction}
10. 优先使用 RAG 提供的线索和任务样例进行改写、组合、在地化。
11. 如果用户只选了一个主题，例如“动物”，所有任务都必须和这个主题直接相关；不允许出现完全无关的声音、气味、色彩等支线任务。
12. 如果用户只选了“动物”，任务必须直接涉及：真实动物、动物痕迹、动物轮廓、像动物的形状、或与动物有关的在地线索，不能写成纯声音观察。
13. 三个任务的切入角度尽量不同，不要只是同一句式的轻微改写；可以分别从主体、关系、空间、时间、对比、来源、变化等不同角度切入。
14. 优先生成“这片地点此刻才能成立”的任务，不要写成任何城市都能套用的空泛观察。
15. 如果是纯粹模式，唯一的那个任务必须写得更丰满，至少包含“寻找/记录什么”以及“留意什么变化、关系或对比”，让它虽然只有一条，但仍然有画面感和探索层次。

返回 JSON：
{
  "title": "主题标题",
  "description": "80字以内的诗意描述",
  "category": "形状/色彩/声音/动物/气味",
  "missions": ["任务 1", "任务 2", "任务 3"],
  "vibeColor": "十六进制颜色"
}`;
}

module.exports = {
  retrieveContext,
  buildFallbackTheme,
  buildPrompt,
};

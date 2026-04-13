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
const RUNTIME_VERSION = '2026-04-13-validation-r1';

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
    scenes: ragContext.scenes.map((scene) => ({
      labels: scene.labels,
      missionHints: scene.missionHints,
    })),
    themes: categories.map((category) => ({
      category,
      references: ragContext.referenceMissions
        .filter((template) => template.category === category)
        .map((template) => ({
          cues: template.cues,
          samples: template.samples,
        })),
    })),
  };
}

function buildModelCombinedReferenceContext(referenceContext) {
  const context = referenceContext && typeof referenceContext === 'object' ? referenceContext : {};
  const ragContext = context.ragContext && typeof context.ragContext === 'object' ? context.ragContext : null;
  return {
    scenes: Array.isArray(context.scenes) ? context.scenes : [],
    themes: (Array.isArray(context.themes) ? context.themes : [])
      .map((item) => ({
        category: item.category,
        references: (Array.isArray(item.references) ? item.references : [])
          .map((reference) => ({
            cues: reference.cues,
          })),
      })),
    ragContext: ragContext ? {
      selectedThemes: ragContext.selectedThemes,
      requestedCategories: ragContext.requestedCategories,
      locationContext: ragContext.locationContext,
      sceneTag: ragContext.sceneTag,
      timeContext: ragContext.timeContext,
      nearbySummary: ragContext.nearbySummary,
      scenes: ragContext.scenes,
      categories: ragContext.categories,
      referenceMissions: (Array.isArray(ragContext.referenceMissions) ? ragContext.referenceMissions : [])
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
      generationIntent: ragContext.generationIntent,
      generationPlan: ragContext.generationPlan,
      ragDebug: ragContext.ragDebug,
    } : null,
    note: '已移除知识库样例原句，模型只能参考角度、线索和锚点，不应照抄样例句。',
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

以下是检索增强上下文（RAG），请优先基于这些信息生成，而不是凭空想象：
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
20. RAG 只提供结构、角度、线索和锚点；不要复用知识库样例句，不要把模板样例当成可直接粘贴的任务文本。

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

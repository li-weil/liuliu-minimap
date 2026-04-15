const { THEME_CATEGORIES, missionTemplates, preferenceBias, sceneProfiles } = require('./knowledge');
const {
  normalizeLocationSignals,
  normalizeCategoryList,
  buildPromptContextBlock,
  normalizeRecentMissionHistory,
  inferMissionActionType,
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

function uniqText(values, limit = 8) {
  const result = [];
  (Array.isArray(values) ? values : [values]).forEach((item) => {
    const text = String(item || '').trim();
    if (text && !result.includes(text) && result.length < limit) {
      result.push(text);
    }
  });
  return result;
}

function hashStringToUnit(value) {
  const text = String(value || '');
  if (!text) {
    return 0;
  }
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function rotateBySeed(values, seed, salt = '') {
  const source = Array.isArray(values) ? values.filter(Boolean) : [];
  if (source.length <= 1 || !seed) {
    return source;
  }
  const offset = Math.floor(hashStringToUnit(`${seed}|${salt}`) * source.length) % source.length;
  return source.slice(offset).concat(source.slice(0, offset));
}

const SHAPE_THEME_LEXICON = {
  visibleTraits: [
    '方', '圆', '长', '短', '高', '低', '宽', '窄', '厚', '薄',
    '横', '竖', '直', '弯', '曲', '折', '尖', '钝', '平', '斜',
    '正', '歪', '对称', '不对称', '密', '疏', '整齐', '错位',
  ],
  contourWords: [
    '轮廓', '外轮廓', '边角', '边缘', '外沿', '折线', '曲线', '弧线',
    '直线', '线条走向', '转角', '拐角', '尖角', '圆角', '棱角', '角度',
  ],
  openingAndFrameWords: [
    '门洞', '窗框', '开口', '洞口', '格子', '方框', '圆框', '边框',
    '栏杆格', '栅格', '镂空', '空隙', '缝隙', '留白', '缺口', '凹口',
  ],
  structureWords: [
    '转折', '接缝', '拼接', '交叉', '延伸', '断开', '连续', '起伏',
    '层叠', '包裹', '穿插', '外凸', '内凹', '上挑', '下压', '围合',
  ],
  scaleWords: [
    '比例', '尺度', '长宽比', '高低差', '宽窄差', '厚薄差', '大小对比', '高矮关系',
    '疏密', '松紧', '间距', '节奏', '排列', '重复', '单元', '序列',
  ],
  geometryWords: [
    '几何', '方形感', '圆形感', '三角感', '矩形感', '梯形感', '半圆', '拱形',
    '弧面', '曲面', '平面', '立面', '斜面', '棱面', '面块', '体块',
  ],
  relationWords: [
    '并排', '错开', '对齐', '错位', '挡住', '露出', '框住', '围住',
    '夹住', '伸出来', '靠近', '远离', '贴着', '叠在一起',
  ],
  objectAnchors: [
    '门', '门洞', '窗', '窗框', '栏杆', '台阶', '扶手', '墙角', '屋檐', '柱子',
    '路桩', '路灯', '花坛边', '围栏', '地砖', '石墩', '招牌边框', '橱窗', '座椅', '雨棚',
  ],
  actionPhrases: [
    '看它是方还是圆',
    '看它更直还是更弯',
    '比较哪一处更窄',
    '找一个最明显的转角',
    '看哪一段线条最硬',
    '找一处圆角',
    '比较两个框口谁更高',
    '看栏杆是密还是疏',
    '找一个被框住的景象',
    '看门洞开口像不像一个明确图形',
    '比较台阶和坡道谁更利落',
    '看一处重复形状怎样排开',
    '找一个最不整齐的边角',
    '看哪一处外轮廓最完整',
    '比较近看和远看时形状有没有变',
  ],
  pairings: [
    '方和圆',
    '直和弯',
    '宽和窄',
    '高和低',
    '尖角和圆角',
    '密和疏',
    '整齐和歪斜',
    '完整和破开',
  ],
  weakAbstractWords: [
    '关系', '秩序', '状态', '气质', '氛围', '张力', '语言', '韵律',
    '美感', '表情', '结构感', '空间感', '形式感',
  ],
};

const SHAPE_TIME_BIASES = {
  凌晨: ['轮廓', '外沿', '边缘', '亮处和暗处之间的形', '路灯下更显眼的转角'],
  清晨: ['门洞', '台阶', '墙角', '树影切出来的形', '湿地面勾出来的边线'],
  上午: ['窗框', '栏杆', '招牌边框', '成排出现的形', '通勤路线里的直和弯'],
  午后: ['影子边线', '高低差', '宽窄对比', '被阳光压出来的形', '重复单元'],
  黄昏: ['亮灯前后的轮廓', '门口开口', '屋檐边线', '被灯光托出来的边角', '剪影感'],
  夜间: ['灯下轮廓', '发光窗口形成的方框', '暗处和亮处的边线', '招牌外轮廓', '夜里更清楚的尖角或圆角'],
};

const SHAPE_SCENE_BIASES = [
  { keywords: ['历史景区', '故宫', '中山公园', '城楼', '古建', '牌楼', '宫'], anchors: ['门洞', '窗框', '屋檐', '石栏杆', '拱形', '柱子'] },
  { keywords: ['公园', '绿地', '水岸', '湖', '河'], anchors: ['栏杆', '桥洞', '台阶', '花坛边', '座椅', '围栏'] },
  { keywords: ['广场', '步行', '街口'], anchors: ['地砖', '路桩', '围栏', '台阶', '路灯', '旗杆基座'] },
  { keywords: ['餐饮', '市场', '烟火', '夜市'], anchors: ['招牌边框', '雨棚', '橱窗', '摊位边线', '门口开口', '桌椅摆放'] },
];

function buildSeedStyleGuide(seed) {
  const normalizedSeed = String(seed || '').trim();
  if (!normalizedSeed) {
    return [];
  }
  const actionStyles = [
    '优先用“停一下 / 绕着看 / 顺着找 / 回头看”这类动作，不要总是“找一处”。',
    '优先用“分辨 / 等一下 / 走近 / 换个位置”这类动作，不要总是“观察一下”。',
    '优先用“沿着 / 借着 / 对着 / 回头看”这类动作，不要总是“留意”。',
  ];
  const structureStyles = [
    '句式尽量短促直接，避免“找一处……留意……”的固定双分句。',
    '句式尽量像真实任务卡片，优先“动作 + 对象 + 观察重点”。',
    '至少有一条任务换成“停一下/等一下/换个位置”结构，不要全是“寻找”结构。',
  ];
  const toneStyles = [
    '本次尽量避免和上一轮相同的开头动词。',
    '本次尽量改变任务里的锚点，不要总围绕同一个 POI 入口句式。',
    '本次尽量改变观察对象和动作，不要总写“某处 + 两层/并列/来源”。',
  ];
  return [
    actionStyles[Math.floor(hashStringToUnit(`${normalizedSeed}|action`) * actionStyles.length) % actionStyles.length],
    structureStyles[Math.floor(hashStringToUnit(`${normalizedSeed}|structure`) * structureStyles.length) % structureStyles.length],
    toneStyles[Math.floor(hashStringToUnit(`${normalizedSeed}|tone`) * toneStyles.length) % toneStyles.length],
  ];
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

function getSingleThemeFreeformTarget(selectedThemes) {
  return Array.isArray(selectedThemes) && selectedThemes.length === 1
    ? selectedThemes[0]
    : '';
}

function getRecentMissionHistory(event, limit = 8) {
  return normalizeRecentMissionHistory(event, limit).map((item) => ({
    mission: String(item.mission || '').trim(),
    category: String(item.category || '').trim(),
    actionType: String(item.actionType || inferMissionActionType(item.mission)).trim(),
    anchor: String(item.anchor || '').trim(),
    title: String(item.title || '').trim(),
  }));
}

function collectShapeSceneText(ragContext) {
  const context = ragContext && typeof ragContext === 'object' ? ragContext : {};
  return uniqText(
    []
      .concat(context.nearbySummary && context.nearbySummary.dominantScene || [])
      .concat(context.generationPlan && context.generationPlan.chosenScene || [])
      .concat(context.nearbySummary && context.nearbySummary.poiNames || []),
    12
  ).join(' ');
}

function buildShapeLexiconSelection(ragContext, event) {
  const seed = String(event && event.generationSeed || '').trim();
  const timePhase = ragContext && ragContext.timeContext && ragContext.timeContext.timePhase
    ? String(ragContext.timeContext.timePhase).trim()
    : '';
  const sceneText = collectShapeSceneText(ragContext);
  const sceneBiasAnchors = SHAPE_SCENE_BIASES
    .filter((item) => item.keywords.some((keyword) => sceneText.includes(keyword)))
    .flatMap((item) => item.anchors || []);
  return {
    mode: 'shape-expanded-candidate-lexicon',
    visibleTraits: rotateBySeed(SHAPE_THEME_LEXICON.visibleTraits, seed, 'shape-visible-traits').slice(0, 12),
    contourWords: rotateBySeed(SHAPE_THEME_LEXICON.contourWords, seed, 'shape-contour-words').slice(0, 10),
    openingAndFrameWords: rotateBySeed(SHAPE_THEME_LEXICON.openingAndFrameWords, seed, 'shape-opening-frame').slice(0, 10),
    structureWords: rotateBySeed(SHAPE_THEME_LEXICON.structureWords, seed, 'shape-structure').slice(0, 8),
    scaleWords: rotateBySeed(SHAPE_THEME_LEXICON.scaleWords, seed, 'shape-scale').slice(0, 8),
    geometryWords: rotateBySeed(SHAPE_THEME_LEXICON.geometryWords, seed, 'shape-geometry').slice(0, 8),
    relationWords: rotateBySeed(SHAPE_THEME_LEXICON.relationWords, seed, 'shape-relations').slice(0, 8),
    objectAnchors: uniqText(
      rotateBySeed([].concat(sceneBiasAnchors, SHAPE_THEME_LEXICON.objectAnchors), seed, 'shape-object-anchors'),
      12
    ),
    actionPhrases: rotateBySeed(SHAPE_THEME_LEXICON.actionPhrases, seed, 'shape-action-phrases').slice(0, 8),
    pairings: rotateBySeed(SHAPE_THEME_LEXICON.pairings, seed, 'shape-pairings').slice(0, 8),
    weakAbstractWords: SHAPE_THEME_LEXICON.weakAbstractWords.slice(0, 10),
    timeBias: uniqText(SHAPE_TIME_BIASES[timePhase] || [], 5),
    sceneBias: uniqText(sceneBiasAnchors, 6),
  };
}

function reorderByRecentCooldown(items, recentValues = [], key = 'id') {
  const history = Array.isArray(recentValues) ? recentValues.filter(Boolean) : [];
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const leftPenalty = history.includes(String(left && left[key] || '').trim()) ? 1 : 0;
    const rightPenalty = history.includes(String(right && right[key] || '').trim()) ? 1 : 0;
    if (leftPenalty !== rightPenalty) {
      return leftPenalty - rightPenalty;
    }
    return 0;
  });
}

function buildSingleThemeMissionPlans(event, ragContext, theme) {
  const shapeLexicon = theme === '形状'
    ? buildShapeLexiconSelection(ragContext, event)
    : null;
  const themeActionPool = {
    形状: [
      { id: '找一处', label: '找一处', instruction: `找一个一眼就能说出形状特点的地方，比如${pickOne(shapeLexicon && shapeLexicon.pairings, '方和圆')}` },
      { id: '绕着看', label: '绕着看', instruction: `围着同一个对象看，判断它更接近${pickOne(shapeLexicon && shapeLexicon.pairings, '直和弯')}` },
      { id: '换个角度', label: '换个角度', instruction: `退后或走近，再看${pickOne(shapeLexicon && shapeLexicon.contourWords, '轮廓')}有没有变化` },
      { id: '从远到近', label: '从远到近', instruction: `先看整体是${pickOne(shapeLexicon && shapeLexicon.pairings, '高和低')}，再贴近看局部` },
      { id: '贴近细部', label: '贴近细部', instruction: `只盯一个${pickOne(shapeLexicon && shapeLexicon.objectAnchors, '窗框')}或${pickOne(shapeLexicon && shapeLexicon.objectAnchors, '门洞')}，看它具体是什么形` },
    ],
    色彩: [
      { id: '找一组颜色', label: '找一组颜色', instruction: '先找到最能代表此刻的一组颜色关系' },
      { id: '比较色差', label: '比较色差', instruction: '比较同一对象在两处位置的颜色差异' },
      { id: '看颜色怎么变', label: '看颜色怎么变', instruction: '停一下，看颜色随位置或光线如何改变' },
      { id: '找最突出的那一块', label: '找最突出的那一块', instruction: '只抓住最先跳出来的色块或材质颜色' },
      { id: '顺着颜色再找下一处', label: '顺着颜色再找下一处', instruction: '让一种颜色带你找到下一处线索' },
    ],
    声音: [
      { id: '停一下听', label: '停一下听', instruction: '先停下来，只抓最近的一层声音' },
      { id: '分辨来源', label: '分辨来源', instruction: '分清一个声音到底从哪里来' },
      { id: '顺着声音走几步', label: '顺着声音走几步', instruction: '跟着一条声音线索移动一小段' },
      { id: '等下一次出现', label: '等下一次出现', instruction: '等同一种声音再出现一次' },
      { id: '回头再听', label: '回头再听', instruction: '走过以后回头听，判断刚才漏掉了什么' },
    ],
    数字: [
      { id: '先猜再确认', label: '先猜再确认', instruction: '先猜一个数字线索的意思，再走近确认' },
      { id: '找一个规则', label: '找一个规则', instruction: '找出一个会影响行动的数字规则' },
      { id: '核对两个线索', label: '核对两个线索', instruction: '拿两个数字提示互相核对' },
      { id: '判断哪个更像提示', label: '判断哪个更像提示', instruction: '找出最像给人指路的数字信息' },
      { id: '找一个会影响行动的数字', label: '找一个会影响行动的数字', instruction: '抓住一个会让你决定往哪走的数字' },
    ],
    气味: [
      { id: '闻到后找来源', label: '闻到后找来源', instruction: '先确认一股味道，再找它从哪里来' },
      { id: '换个位置再闻', label: '换个位置再闻', instruction: '前后挪一步，看气味怎么变' },
      { id: '等风过来', label: '等风过来', instruction: '先停一会，等味道自己过来' },
      { id: '比较前后变化', label: '比较前后变化', instruction: '比较同一条路上前后两处气味差异' },
      { id: '找最容易停下的一处', label: '找最容易停下的一处', instruction: '找一处会让你因为味道停一下的地方' },
    ],
  };
  const themeAnglePool = {
    形状: shapeLexicon && Array.isArray(shapeLexicon.pairings) && shapeLexicon.pairings.length
      ? shapeLexicon.pairings
      : ['方和圆', '直和弯', '高和低', '宽和窄', '密和疏', '整齐和歪斜'],
    色彩: ['材质色差', '人工与自然', '新旧对比', '局部跳色', '行进中的颜色变化'],
    声音: ['近处与远处', '动作触发的声音', '停留点底噪', '穿行时的变化', '人群与设备谁更明显'],
    数字: ['顺序提示', '行动规则', '重复单位', '数字变体', '判断与确认'],
    气味: ['来源变化', '扩散路径', '停留感', '空气状态', '经过时浓淡变化'],
  };
  const themeAvoidPhrases = {
    形状: ['数清', '编号', '多少'],
    色彩: ['气质', '关系', '边界'],
    声音: ['边界', '关系', '秩序'],
    数字: ['数字感', '秩序感'],
    气味: ['边界', '氛围', '状态'],
  };
  const missionCount = event.walkMode === 'advanced' ? 3 : 1;
  const seed = event.generationSeed || '';
  const recentHistory = getRecentMissionHistory(event, 8);
  const recentActions = recentHistory.map((item) => item.actionType).filter(Boolean);
  const recentAnchors = recentHistory.map((item) => item.anchor).filter(Boolean);
  const actionPool = reorderByRecentCooldown(
    rotateBySeed(themeActionPool[theme] || [], `${seed}|mission-action|${theme}`),
    recentActions,
    'id'
  );
  const anglePool = rotateBySeed(themeAnglePool[theme] || [], `${seed}|mission-angle|${theme}`);
  const anchorPool = reorderByRecentCooldown(
    rotateBySeed(uniqText(
      []
        .concat(ragContext.generationPlan && ragContext.generationPlan.primaryAnchors || [])
        .concat(ragContext.nearbySummary && ragContext.nearbySummary.poiNames || [])
        .concat(ragContext.nearbySummary && ragContext.nearbySummary.activityHints || []),
      8
    ).map((item) => ({ value: item })), `${seed}|mission-anchor|${theme}`),
    recentAnchors,
    'value'
  );
  const scene = ragContext.generationPlan && ragContext.generationPlan.chosenScene
    ? ragContext.generationPlan.chosenScene
    : ragContext.nearbySummary && ragContext.nearbySummary.dominantScene
      ? ragContext.nearbySummary.dominantScene
      : '';
  const timePhase = ragContext.timeContext && ragContext.timeContext.timePhase
    ? ragContext.timeContext.timePhase
    : '';
  const plans = [];
  for (let index = 0; index < missionCount; index += 1) {
    const action = actionPool[index % Math.max(actionPool.length, 1)] || { id: '找一处', label: '找一处', instruction: '抓住一个具体对象' };
    const angle = anglePool[index % Math.max(anglePool.length, 1)] || '';
    const anchorEntry = anchorPool[index % Math.max(anchorPool.length, 1)] || null;
    const anchor = anchorEntry ? anchorEntry.value : '';
    plans.push({
      slot: index + 1,
      theme,
      actionType: action.label,
      actionInstruction: action.instruction,
      anchor,
      scene,
      timePhase,
      observationAngle: angle,
      avoidPhrases: themeAvoidPhrases[theme] || [],
      avoidRecentPatterns: recentHistory.map((item) => item.mission).slice(0, 4),
    });
  }
  return plans;
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
  const selectedThemes = normalizeSelectedThemes(event.selectedThemes, event);
  const singleThemeFreeformTarget = getSingleThemeFreeformTarget(selectedThemes);
  const ragContext = buildUnifiedRetrievalContext(event, {
    selectedThemes,
    missionTemplates: singleThemeFreeformTarget
      ? missionTemplates.filter((template) => template.category !== singleThemeFreeformTarget)
      : missionTemplates,
    sceneProfiles,
    themeCategories: THEME_CATEGORIES,
    preferenceBias,
  });
  if (!singleThemeFreeformTarget) {
    return {
      ...ragContext,
      generationSeed: event.generationSeed || '',
    };
  }
  const missionPlans = buildSingleThemeMissionPlans(event, ragContext, singleThemeFreeformTarget);
  return {
    ...ragContext,
    generationSeed: event.generationSeed || '',
    referenceMissions: [],
    scenes: (Array.isArray(ragContext.scenes) ? ragContext.scenes : []).map((scene) => ({
      ...scene,
      missionHints: [],
    })),
    generationPlan: {
      ...(ragContext.generationPlan || {}),
      recommendedAngles: [],
      antiPatterns: [],
      plannerMode: 'single-theme-mission-plan',
      missionPlans,
    },
    ragDebug: {
      ...(ragContext.ragDebug || {}),
      retrievalQuality: 'single-theme-freeform',
      diversityAngles: [],
      antiPatterns: [],
      selectedReferenceIds: [],
      experimentMode: 'single-theme-freeform-grounding',
      freeformTheme: singleThemeFreeformTarget,
      plannerMode: 'single-theme-mission-plan',
      recentHistorySize: getRecentMissionHistory(event, 8).length,
    },
    experimentMode: 'single-theme-freeform-grounding',
    freeformTheme: singleThemeFreeformTarget,
  };
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
    supportingScenes: Array.isArray(plan.supportingScenes) ? plan.supportingScenes : [],
    sceneCoverage: Array.isArray(debug.sceneCoverage) ? debug.sceneCoverage : [],
    plannerMode: String(plan.plannerMode || debug.plannerMode || '').trim(),
    missionPlans: Array.isArray(plan.missionPlans) ? plan.missionPlans : [],
  };
}

function buildCompactTimeModel(timeContext) {
  const context = timeContext && typeof timeContext === 'object' ? timeContext : {};
  return {
    phase: context.timePhase || '',
    hints: uniqText(context.timeHints || [], 4),
  };
}

function buildCompactNearbyModel(nearbySummary) {
  const summary = nearbySummary && typeof nearbySummary === 'object' ? nearbySummary : {};
  return {
    poiNames: uniqText(summary.poiNames || [], 5),
    dominantScene: summary.dominantScene || '',
    activityHints: uniqText(summary.activityHints || [], 4),
  };
}

function buildCompactSceneCards(scenes, selectedThemes, options = {}) {
  const allowedThemes = new Set(Array.isArray(selectedThemes) ? selectedThemes : []);
  const suppressMissionHints = !!options.suppressMissionHints;
  return (Array.isArray(scenes) ? scenes : [])
    .slice(0, 3)
    .map((scene) => {
      const labels = uniqText(scene.labels || [], 2);
      return {
        label: labels.join(' / '),
        categories: (Array.isArray(scene.categories) ? scene.categories : [])
          .filter((category) => !allowedThemes.size || allowedThemes.has(category))
          .slice(0, 3),
        missionHints: suppressMissionHints ? [] : uniqText(scene.missionHints || [], 3),
      };
    })
    .filter((scene) => scene.label || scene.missionHints.length);
}

function buildSimpleThemeHints(selectedThemes, options = {}) {
  if (options.singleThemeFreeformTarget) {
    const theme = options.singleThemeFreeformTarget;
    const shapeLexicon = options.shapeLexicon && typeof options.shapeLexicon === 'object'
      ? options.shapeLexicon
      : null;
    const freeformHintsByTheme = {
      形状: [
        '保持形状主题即可，自由发挥，不要套固定词库。',
        `优先从可见形状候选里自由组合，例如${uniqText([].concat(shapeLexicon && shapeLexicon.pairings || [], shapeLexicon && shapeLexicon.contourWords || []), 4).join('、') || '方和圆、直和弯、尖角和圆角'}。`,
        '不要反复只落回弧度、弧线、轮廓、边角、边界中的一两个词，要换对象、换动作、换比较维度。',
      ],
      色彩: [
        '保持色彩主题即可，自由发挥，不要套固定色彩模板。',
        '优先关注此时此地的颜色关系、材质差异、人工与自然、旧与新。',
        '不要反复落回反光、光照、冷暖色这类固定写法。',
      ],
      声音: [
        '保持声音主题即可，自由发挥，不要套固定声音模板。',
        '优先关注此时此地具体能听见的对象、动作触发、停留变化和人与环境的互动。',
        '不要反复落回来源、回响、前后景两层这类固定写法，也不要写成“声音的边界”这种抽象说法。',
      ],
      数字: [
        '保持数字主题即可，自由发挥，不要套固定数字模板。',
        '优先关注此时此地的数字线索、顺序、选择与判断动作。',
        '不要反复落回门牌号、编号、数一数这类固定写法。',
      ],
      气味: [
        '保持气味主题即可，自由发挥，不要套固定气味模板。',
        '优先关注此时此地的来源变化、扩散方式、停留感觉和行动线索。',
        '不要反复落回食物香、潮气、冷热交界这类固定写法。',
      ],
    };
    return freeformHintsByTheme[theme] || [
      `保持${theme}主题即可，自由发挥，不要套固定词库。`,
      '优先关注此时此地真实成立的关系与变化。',
      '不要反复落回少数几个固定表达。',
    ];
  }
  const hintsByTheme = {
    形状: [
      '关注可见结构、对象关系、空间组织和局部变化。',
      '不要把任务收窄成固定词库，也不要写成数量统计。',
      '优先让任务落在“看出关系或变化”，而不是套用同一种表达。',
    ],
    色彩: [
      '关注颜色关系、冷暖变化、明暗层次、反差和环境色。',
      '可以写颜色如何被周围托出来，不要只写抽象氛围词。',
      '优先让任务落在“颜色怎样影响现场感受”。',
    ],
    声音: [
      '关注来源、远近、持续与突发、遮挡、回响和层次变化。',
      '可以写声音怎样影响停留和行动，不要写成泛泛“听一听”。',
      '优先让任务落在“分辨、判断、比较、等待变化”。',
    ],
    数字: [
      '关注像数字的形状、数量关系、编号系统、顺序、密码感和重复单位。',
      '可以把数字理解为一种观察线索，但任务仍要明确落在数字判断上。',
      '优先让任务落在“辨认、对照、验证、发现规律”。',
    ],
    气味: [
      '关注来源、扩散、浓淡变化、冷热交界、停留与散开。',
      '可以写气味和空间、时间、行动的关系，不要只写“闻到什么”。',
      '优先让任务落在“判断从哪里来、在哪里变强或变淡”。',
    ],
  };
  return uniqText(
    uniqText(selectedThemes, 3).flatMap((theme) => hintsByTheme[theme] || []),
    8
  );
}

function buildRagModelInput(ragContext) {
  const context = ragContext && typeof ragContext === 'object' ? ragContext : {};
  const selectedThemes = Array.isArray(context.selectedThemes) && context.selectedThemes.length
    ? context.selectedThemes
    : (Array.isArray(context.categories) ? context.categories : []);
  const singleThemeFreeformTarget = context.experimentMode === 'single-theme-freeform-grounding'
    ? String(context.freeformTheme || '').trim()
    : getSingleThemeFreeformTarget(selectedThemes);
  const themeLexicon = singleThemeFreeformTarget === '形状'
    ? {
        形状: buildShapeLexiconSelection(context, {
          generationSeed: context.generationSeed || '',
        }),
      }
    : {};
  return {
    targetThemes: uniqText(selectedThemes, 3),
    time: buildCompactTimeModel(context.timeContext),
    nearby: buildCompactNearbyModel(context.nearbySummary),
    sceneCards: buildCompactSceneCards(context.scenes, selectedThemes, {
      suppressMissionHints: !!singleThemeFreeformTarget,
    }),
    missionPlans: Array.isArray(context.generationPlan && context.generationPlan.missionPlans)
      ? context.generationPlan.missionPlans.slice(0, context.walkMode === 'advanced' ? 3 : 1)
      : [],
    themeHints: buildSimpleThemeHints(selectedThemes, {
      singleThemeFreeformTarget,
      shapeLexicon: themeLexicon['形状'] || null,
    }),
    themeLexicon,
    themeGuidanceMode: singleThemeFreeformTarget ? 'single-theme-freeform-grounding' : 'light-hints-only',
  };
}

function buildPromptCoreContext(promptContext, event) {
  const context = promptContext && typeof promptContext === 'object' ? promptContext : {};
  const timeContext = context.timeContext && typeof context.timeContext === 'object' ? context.timeContext : {};
  const nearbySummary = context.nearbySummary && typeof context.nearbySummary === 'object' ? context.nearbySummary : {};
  const locationSignals = context.locationSignals && typeof context.locationSignals === 'object' ? context.locationSignals : {};
  return {
    location: locationSignals.locationName || event.locationName || '当前位置',
    sceneTag: locationSignals.sceneTag || locationSignals.locationContext || '',
    timePhase: timeContext.timePhase || '',
    timeHints: uniqText(timeContext.timeHints || [], 3),
    nearbyScene: nearbySummary.dominantScene || '',
    poiNames: uniqText(nearbySummary.poiNames || [], 3),
    activityHints: uniqText(nearbySummary.activityHints || [], 2),
    skeletonHints: uniqText(context.skeletonHints || [], event.walkMode === 'advanced' ? 3 : 2),
  };
}

function buildPromptThemeRules(selectedThemes, walkMode) {
  if (!selectedThemes.length) {
    return [
      '主题可以自由判断，但标题、描述和任务必须方向一致。',
      '任务必须贴合当前地点和时间，不能写成泛用空话。',
    ];
  }
  if (selectedThemes.length === 1) {
    const theme = selectedThemes[0];
    const rulesByTheme = {
      形状: [
        '只围绕形状主题展开，优先写方圆、直弯、宽窄、高低、尖圆、疏密、整齐或歪斜这些具体可见特征，不要写成数数。',
        '不要反复落回弧度、弧线、轮廓、边角、边界这类单一词。',
      ],
      色彩: [
        '只围绕色彩主题展开，允许颜色关系、材质色差、新旧差异、街区色调。',
        '不要默认收窄成反光、光照、色温。',
      ],
      声音: [
        '只围绕声音主题展开，允许动作触发、停留变化、生活节奏、人与环境互动。',
        '不要默认收窄成来源、回响、两层声音，也不要写抽象声场词。',
      ],
      数字: [
        '只围绕数字主题展开，允许顺序、规则、判断、数字变体、行动线索。',
        '不要只剩门牌号、编号、数一数这几种写法。',
      ],
      气味: [
        '只围绕气味主题展开，允许来源变化、扩散方式、停留感、空气状态。',
        '不要默认收窄成食物香、潮气、冷热交界。',
      ],
    };
    return rulesByTheme[theme] || [`只围绕${theme}主题展开，不要扩展到未选主题。`];
  }
  return [
    `只围绕 ${selectedThemes.join('、')} 展开，不要加入第三种无关主题。`,
    walkMode === 'advanced'
      ? '至少 2 条任务能直接看出所选主题的痕迹。'
      : '唯一任务必须直接体现所选主题。',
  ];
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
  const recentMissionHistory = getRecentMissionHistory(event, 6);
  const previousMissions = uniqText(recentMissionHistory.map((item) => item.mission), 4);
  const seedStyleGuide = buildSeedStyleGuide(generationSeed);
  const promptContext = buildPromptContextBlock(event, {
    categories: selectedThemes.length ? selectedThemes : ragContext.categories,
    walkMode: event.walkMode,
  });
  const planDigest = buildPlanDigest(ragContext);
  const ragModelInput = buildRagModelInput(ragContext);
  const promptCoreContext = buildPromptCoreContext(promptContext, event);
  const themeRules = buildPromptThemeRules(selectedThemes, event.walkMode);
  const modeInstruction = event.walkMode === 'advanced'
    ? '生成 3 个短而清楚的任务，每条尽量控制在 16 到 28 个字。'
    : '只生成 1 个短而清楚的任务，优先写成“动作 + 观察重点”的一句话，尽量控制在 32 个字以内，不要写成长段落。';
  const compactRagModelInput = {
    targetThemes: ragModelInput.targetThemes,
    time: ragModelInput.time,
    nearby: ragModelInput.nearby,
    themeHints: uniqText(ragModelInput.themeHints || [], 4),
    themeLexicon: ragModelInput.themeLexicon || {},
    missionPlans: Array.isArray(ragModelInput.missionPlans)
      ? ragModelInput.missionPlans.slice(0, event.walkMode === 'advanced' ? 3 : 1)
      : [],
  };
  const compactPlan = {
    chosenScene: planDigest.chosenScene,
    primaryAnchors: uniqText(planDigest.primaryAnchors || [], 3),
    missionPlans: Array.isArray(planDigest.missionPlans)
      ? planDigest.missionPlans.slice(0, event.walkMode === 'advanced' ? 3 : 1)
      : [],
  };

  return `你正在为微信小程序“遛遛”生成一次城市漫步主题。

输入：
${JSON.stringify({
  mood: event.mood,
  weather: event.weather,
  season: event.season,
  preference: event.preference,
  selectedThemes,
  location: locationSignals.locationName || event.locationName || '当前位置',
  walkMode: event.walkMode,
  generationSeed: generationSeed || '',
  previousMissions,
  styleGuide: seedStyleGuide,
}, null, 2)}

grounding：
${JSON.stringify(promptCoreContext, null, 2)}

RAG：
${JSON.stringify(compactRagModelInput, null, 2)}

plan：
${JSON.stringify(compactPlan, null, 2)}

生成要求：
1. 先贴合地点、时间段、附近场景，再写主题，不要写成泛用空话。
2. category 优先使用用户所选主题；若只选一个主题，所有任务都必须只围绕它。
3. ${themeRules.join(' ')}
4. 如果没选数字，禁止把“数清、数一数、数量、编号、门牌、楼层”当核心动作。
5. 如果提供了 missionPlans，请优先遵守 actionType、anchor、observationAngle、avoidPhrases，但要写成自然短句，不要照抄 plan。
5.1. 如果提供了 themeLexicon，请把它当作候选词库自由选词组合，优先选择最贴合当前时间、场景、对象的词，不要机械复述同一个词。
6. 优先呼应 timeHints、附近 POI、activityHints，但不要围着同一个 POI 重复写。
7. 任务必须具体、可执行、像真实任务卡片，避免“边界、关系、秩序、气质、氛围”这类抽象对象。
8. 如果 previousMissions 非空，必须逐条避开上一轮任务；禁止生成与 previousMissions 在动作、对象、锚点、观察角度、句式上相同或近似相同的任务，不能只替换个别词语继续复用。
9. 同一地点重复生成时，要根据 generationSeed 和 previousMissions 主动换动作、锚点、观察角度。
10. ${modeInstruction}
11. 标题 12 字内，描述 32 字内；标题不要带编号，不要写成“声流5”“主题2”。

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

const cloud = require('wx-server-sdk');
const { chatJson } = require('./ai');
const { retrieveContext, buildFallbackTheme, buildPrompt } = require('./rag');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const includeDebugContext = process.env.DEBUG_RAG_CONTEXT === 'true';

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

function normalizeSelectedThemes(selectedThemes) {
  return (Array.isArray(selectedThemes) ? selectedThemes : [])
    .map((item) => String(item || '').replace(/漫步/g, '').trim())
    .filter(Boolean);
}

function isAnimalMission(mission) {
  const text = String(mission || '');
  return /动物|猫|狗|鸟|雀|鸽|燕|鱼|昆虫|爪印|羽毛|尾巴|耳朵|胡须|像.*动物|动物痕迹/.test(text);
}

function isShapeMission(mission) {
  const text = String(mission || '');
  return /形状|轮廓|线条|弧|圆角|几何|对称|拱|边角|门洞|窗框/.test(text);
}

function isColorMission(mission) {
  const text = String(mission || '');
  return /色|颜色|色彩|红|蓝|黄|绿|渐变|撞色|明暗|色块/.test(text);
}

function isSoundMission(mission) {
  const text = String(mission || '');
  return /声音|声|听|节奏|回响|风声|脚步|铃声|叫卖|环境声/.test(text);
}

function isSmellMission(mission) {
  const text = String(mission || '');
  return /气味|味道|香|臭|闻|潮气|草木味|烟火味|食物香/.test(text);
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
  动物: {
    matcher: isAnimalMission,
    title: (locationName) => `${locationName || '这片街区'}的动物漫步`,
    description: (locationName) => `沿着 ${locationName || '这片街区'} 的街巷，寻找真实动物、动物痕迹，或像动物的轮廓与神情。`,
    fallbackMissions: [
      '寻找一处像动物轮廓的街头形状，并说出它像什么动物',
      '记录街区里真实出现的一只小动物，或它留下的痕迹',
      '找到一处最像动物神情的细节，并拍下来',
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
    title: new RegExp(onlyTheme).test(theme.title || '') ? theme.title : rule.title(event.locationName),
    description: rule.matcher(theme.description || '')
      ? theme.description
      : rule.description(event.locationName),
    missions: completedMissions.slice(0, event.walkMode === 'advanced' ? 3 : 1),
  };
}

exports.main = async (event) => {
  const ragContext = retrieveContext(event);
  const fallbackTheme = normalizeTheme(buildFallbackTheme(event, ragContext), event.walkMode);
  const prompt = buildPrompt(event, ragContext);

  try {
    const theme = normalizeTheme(await chatJson(
      '你是遛遛小程序的城市漫步策划助手。只返回合法 JSON，不要输出额外解释。',
      prompt
    ), event.walkMode);
    const alignedTheme = forceThemeAlignment(theme, event, fallbackTheme);
    return {
      theme: { ...fallbackTheme, ...alignedTheme },
      source: 'rag+ai',
      ragContext: includeDebugContext ? ragContext : undefined,
    };
  } catch (error) {
    return {
      theme: fallbackTheme,
      source: 'rag-fallback',
      ragContext: includeDebugContext ? ragContext : undefined,
      reason: error.message || 'generate_failed',
    };
  }
};

const PRESET_THEMES = [
  {
    title: '形状漫步：意外的弧线',
    description: '沿着街道寻找不属于直线城市的柔软边缘。',
    category: '形状漫步',
    missions: ['寻找一个带弧度的招牌', '拍下一处圆角细节', '记下最让你驻足的形状'],
    vibeColor: '#6b7c59',
  },
  {
    title: '声音漫步：近处与远处',
    description: '用耳朵划分空间，找到今天城市最轻的一层声音。',
    category: '声音漫步',
    missions: ['找到一处连续的环境声', '记录一种突然出现的声音', '写下你听到的节奏'],
    vibeColor: '#52708a',
  },
  {
    title: '色彩漫步：今日的红',
    description: '从城市的零散颜色里找出情绪最明显的一笔。',
    category: '色彩漫步',
    missions: ['寻找一处醒目的红色', '拍下两种相邻的颜色', '记住让你停下来的那一抹色块'],
    vibeColor: '#b96a55',
  },
  {
    title: '数字漫步：街角暗号',
    description: '在街头收集像数字的形状、数量和编号线索。',
    category: '数字漫步',
    missions: ['找一个像 0 的圆形细节', '凑齐 3 个同类元素并拍下', '找到一个门牌号或数字变体'],
    vibeColor: '#8c7356',
  },
];

const RANDOM_THEME_CATEGORIES = ['色彩漫步', '形状漫步', '声音漫步', '气味漫步', '数字漫步'];

const COMBINE_THEME_OPTIONS = ['色彩', '形状', '声音', '气味', '数字', '随机'];

const MOODS = ['发呆', '元气满满', '忧郁', '愉悦', '未知'];
const WEATHERS = ['晴朗', '多云', '雨天', '大风'];
const SEASONS = ['春', '夏', '秋', '冬'];
const PREFERENCES = ['自然景观', '人文历史', '市井烟火'];

module.exports = {
  PRESET_THEMES,
  RANDOM_THEME_CATEGORIES,
  COMBINE_THEME_OPTIONS,
  MOODS,
  WEATHERS,
  SEASONS,
  PREFERENCES,
};

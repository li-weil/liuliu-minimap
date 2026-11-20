// 东澳岛探索示意地图数据。
// 海岸线与点位坐标来自 dongao_island_in_hand 项目（viewBox 600x480），为风格化示意，不代表真实经纬度。
// spotName 对应小程序云函数使用的景点名（initDongaoSpots / dongaoGenerate 的 map_name）。

const VIEW_W = 600;
const VIEW_H = 480;

const COASTLINE = [
  [93.0, 209.5], [119.4, 178.0], [145.8, 146.5], [165.0, 119.2], [179.4, 112.9],
  [172.2, 136.0], [189.0, 148.6], [217.8, 136.0], [210.6, 157.0], [227.4, 165.4],
  [246.6, 140.2], [249.0, 115.0], [297.0, 98.2], [333.0, 83.5], [366.6, 89.8],
  [393.0, 102.4], [414.6, 91.9], [438.6, 98.2], [453.0, 115.0], [455.4, 140.2],
  [445.8, 163.3], [419.4, 184.3], [400.2, 199.0], [383.4, 222.1], [357.0, 249.4],
  [330.6, 257.8], [345.0, 232.6], [361.8, 209.5], [393.0, 188.5], [426.6, 205.3],
  [460.2, 201.1], [477.0, 196.9], [493.8, 207.4], [498.6, 222.1], [491.4, 247.3],
  [493.8, 262.0], [517.8, 268.3], [510.6, 280.9], [479.4, 297.7], [453.0, 312.4],
  [433.8, 322.9], [436.2, 337.6], [421.8, 354.4], [388.2, 356.5], [357.0, 369.1],
  [328.2, 375.4], [294.6, 373.3], [273.0, 360.7], [246.6, 362.8], [234.6, 356.5],
  [210.6, 364.9], [193.8, 381.7], [174.6, 379.6], [186.6, 358.6], [196.2, 337.6],
  [174.6, 327.1], [172.2, 314.5], [184.2, 293.5], [189.0, 272.5], [179.4, 257.8],
  [160.2, 249.4], [153.0, 238.9], [141.0, 247.3], [121.8, 243.1], [109.8, 230.5],
];

const GUIDE_POINTS = [
  { id: 'dongao-pier', title: '东澳码头', spotName: '东澳湾', x: 329, y: 244, labelSide: 'bottom', icon: 'pt-pier', description: '船影穿过东澳湾，从海风里选一段今天的漫游。' },
  { id: 'shan-haijing-bookstore', title: '山海经书屋', spotName: '山海经书屋', x: 365, y: 350, labelSide: 'bottom', icon: 'pt-bookstore', description: '面朝山海读几页书，把此刻写进旅行寄语。' },
  { id: 'nansha-bay', title: '南沙湾沙滩', spotName: '南沙湾沙滩', x: 198, y: 315, labelSide: 'bottom', icon: 'pt-beach', description: '在沙湾与林海之间，挑一段海岸散步或水上主题。' },
  { id: 'cliff-inscription', title: '摩崖石刻', spotName: '摩崖石刻', x: 397, y: 164, labelSide: 'left', icon: 'pt-cliff', description: '沿岩壁题字，寻找海岛留下的历史痕迹。' },
  { id: 'stone-forest', title: '将军石林', spotName: '将军石林', x: 445, y: 140, labelSide: 'right', icon: 'pt-stonewar', description: '停下来看看海风如何雕出石林的轮廓。' },
  { id: 'dongao-fort', title: '东澳铳城', spotName: '铳城', x: 400, y: 106, labelSide: 'top', icon: 'pt-fort', description: '从城墙与炮位读一段海防旧事。' },
  { id: 'honeymoon-pavilion', title: '蜜月阁', spotName: '蜜月阁', x: 245, y: 213, labelSide: 'bottom', icon: 'pt-pavilion', description: '走近半山楼阁，眺望山脊与海色。' },
  { id: 'wedding-hall', title: '婚礼堂', spotName: '婚礼堂', x: 208, y: 226, labelSide: 'top', icon: 'pt-chapel', description: '白色三角建筑与落地玻璃，和蜜月阁是两处不同景观。' },
  { id: 'forest-boardwalk', title: '森林栈道', spotName: '森林栈道', x: 283, y: 287, labelSide: 'bottom', icon: 'pt-boardwalk', description: '沿林间步道慢行，让树影和远海交替入眼。' },
  { id: 'windmill-hill', title: '风车山', spotName: '风车山', x: 310, y: 141, labelSide: 'bottom', icon: 'pt-windmill', description: '到山脊上看看风机、晚霞与开阔海面。' },
  { id: 'hotel-service-area', title: '酒店服务区', spotName: '东澳岛旅游度假区', x: 200, y: 252, labelSide: 'bottom', icon: 'pt-hotel', description: '山海之间的度假建筑与岛上服务风景。' },
];

const GUIDE_ROUTES = [
  {
    id: 'south-coast',
    title: '南岸慢游',
    kind: 'island',
    stopIds: ['dongao-pier', 'shan-haijing-bookstore', 'nansha-bay'],
    pathPoints: [
      [329, 244], [324, 253], [330, 265], [336, 284], [365, 303], [401, 320],
      [418, 337], [394, 351], [365, 350], [330, 351], [293, 342], [261, 334],
      [231, 337], [211, 329], [198, 315],
    ],
  },
  {
    id: 'north-heritage',
    title: '海防寻迹',
    kind: 'island',
    stopIds: ['dongao-pier', 'cliff-inscription', 'stone-forest', 'dongao-fort'],
    pathPoints: [
      [329, 244], [332, 231], [342, 215], [357, 206], [372, 188], [397, 164],
      [425, 154], [445, 140], [431, 125], [417, 113], [400, 106],
    ],
  },
];

module.exports = {
  VIEW_W,
  VIEW_H,
  COASTLINE,
  GUIDE_POINTS,
  GUIDE_ROUTES,
};

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const SPOTS_DATA = [
  { "map_name": "小竹湾沙滩", "amap_name": "", "coords": "113.702558,22.025959" },
  { "map_name": "月伴湾（大竹湾沙滩）", "amap_name": "", "coords": "113.706455,22.02521" },
  { "map_name": "听涛步道", "amap_name": "听涛石廊路", "coords": "113.721752,22.027634" },
  { "map_name": "灵犀台", "amap_name": "", "coords": "113.71744,22.029065" },
  { "map_name": "仙鹊桥", "amap_name": "", "coords": "113.718806,22.029352" },
  { "map_name": "将军石林", "amap_name": "东澳岛-将军石", "coords": "113.721741,22.026729" },
  { "map_name": "铳城", "amap_name": "东澳岛-铳城", "coords": "113.721045,22.024948" },
  { "map_name": "烽火台", "amap_name": "东澳岛-烽火台", "coords": "113.721297,22.024500" },
  { "map_name": "东澳岛海关遗址", "amap_name": "东澳岛-海关遗址", "coords": "113.719920,22.024427" },
  { "map_name": "摩崖石刻", "amap_name": "摩崖石刻", "coords": "113.716646,22.021648" },
  { "map_name": "水手房遗址", "amap_name": "海关水手房遗址", "coords": "113.719665,22.023909" },
  { "map_name": "映月滩", "amap_name": "", "coords": "113.718855,22.023563" },
  { "map_name": "东澳湾", "amap_name": "东澳湾沙滩", "coords": "113.713536,22.017373" },
  { "map_name": "婚礼堂", "amap_name": "", "coords": "113.696811,22.021783" },
  { "map_name": "蜜月阁", "amap_name": "蜜月阁", "coords": "113.700040,22.021650" },
  { "map_name": "森林栈道", "amap_name": "", "coords": "113.698689,22.022294" },
  { "map_name": "心心相印", "amap_name": "", "coords": "113.698871,22.023401" },
  { "map_name": "斜行电梯", "amap_name": "东澳岛蜜月电梯", "coords": "113.698773,22.022203" },
  { "map_name": "观海亭", "amap_name": "", "coords": "113.698489,22.02068" },
  { "map_name": "观月亭", "amap_name": "观月台", "coords": "113.701011,22.019421" },
  { "map_name": "滨海栈道", "amap_name": "", "coords": "113.701571,22.018294" },
  { "map_name": "南沙湾沙滩", "amap_name": "格力东澳大酒店沙滩(南沙湾沙滩)", "coords": "113.705085,22.018745" },
  { "map_name": "月牙环", "amap_name": "", "coords": "113.704917,22.018557" },
  { "map_name": "东澳湾沙滩", "amap_name": "东澳湾沙滩", "coords": "113.713536,22.017373" },
  { "map_name": "音乐阶梯", "amap_name": "", "coords": "113.71386,22.01695" },
  { "map_name": "万觅书店", "amap_name": "万觅书店", "coords": "113.714008,22.017000" },
  { "map_name": "大王庙", "amap_name": "大王庙", "coords": "113.716481,22.018602" },
  { "map_name": "万山海洋生物科普馆", "amap_name": "万山海洋生物科普馆", "coords": "113.712819,22.017317" },
  { "map_name": "风车山", "amap_name": "风车山", "coords": "113.711937,22.024095" },
  { "map_name": "求子泉", "amap_name": "求子泉", "coords": "113.710299,22.020329" },
  { "map_name": "揽海台", "amap_name": "", "coords": "113.715349,22.009314" },
  { "map_name": "开心石", "amap_name": "开心石", "coords": "113.721859,22.021531" },
  { "map_name": "罗刀湾石滩", "amap_name": "", "coords": "113.723084,22.021499" },
  { "map_name": "山海经书屋", "amap_name": "山海经书屋", "coords": "113.725625,22.021175" },
  { "map_name": "飞鹰驿站", "amap_name": "飞鹰驿站", "coords": "113.719539,22.011468" },
  { "map_name": "叠石", "amap_name": "叠石", "coords": "113.719356,22.011191" },
  { "map_name": "夕阳驿站", "amap_name": "浣霞楼(夕阳驿站)", "coords": "113.708201,22.011768" },
  { "map_name": "东澳岛旅游度假区", "amap_name": "东澳岛旅游度假区", "coords": "113.712927,22.019270" },
  { "map_name": "东澳岛蜜月山风景区", "amap_name": "东澳岛蜜月山风景区", "coords": "113.698796,22.022256" },
  { "map_name": "东澳岛-观海平台", "amap_name": "东澳岛-观海平台", "coords": "113.725794,22.021320" },
  { "map_name": "东澳岛-海龙泉", "amap_name": "东澳岛-海龙泉", "coords": "113.718080,22.023159" },
  { "map_name": "东澳岛-风荡石", "amap_name": "东澳岛-风荡石", "coords": "113.717052,22.022009" },
  { "map_name": "东澳岛-石景长廊", "amap_name": "东澳岛-石景长廊", "coords": "113.716267,22.020814" },
  { "map_name": "东澳岛-双豚出海", "amap_name": "东澳岛-双豚出海", "coords": "113.716664,22.021403" },
  { "map_name": "东澳岛-自在佛", "amap_name": "东澳岛-自在佛", "coords": "113.719937,22.023994" },
  { "map_name": "钻石银滩(南沙湾)", "amap_name": "钻石银滩(南沙湾)", "coords": "113.704710,22.018668" },
  { "map_name": "东澳湾灯桩", "amap_name": "东澳湾灯桩", "coords": "113.715989,22.020312" },
  { "map_name": "东澳岛蜜月山景区山海云道", "amap_name": "东澳岛蜜月山景区山海云道", "coords": "113.704251,22.020812" },
  { "map_name": "万海平波", "amap_name": "万海平波", "coords": "113.716655,22.021730" },
  { "map_name": "观月台", "amap_name": "观月台", "coords": "113.701011,22.019421" },
  { "map_name": "东澳岛-铳城亭", "amap_name": "东澳岛-铳城", "coords": "113.721045,22.024948" },
  { "map_name": "街心公园", "amap_name": "街心公园", "coords": "113.714679,22.019882" },
  { "map_name": "珠海东澳岛万豪度假酒店", "amap_name": "珠海东澳岛万豪度假酒店", "coords": "113.703981,22.025062", "category": "stay" },
  { "map_name": "阿丽拉珠海东澳岛", "amap_name": "阿丽拉珠海东澳岛", "coords": "113.706530,22.009122", "category": "stay" },
  { "map_name": "珠海东澳岛安麓酒店", "amap_name": "珠海东澳岛安麓酒店", "coords": "113.726610,22.020223", "category": "stay" },
  { "map_name": "格力东澳大酒店", "amap_name": "格力东澳大酒店", "coords": "113.703204,22.019507", "category": "stay" },
  { "map_name": "珠海东澳岛可域度假村", "amap_name": "珠海东澳岛可域度假村", "coords": "113.706252,22.015404", "category": "stay" },
  { "map_name": "万觅餐吧", "amap_name": "东澳湾万觅餐吧(东澳岛店)", "coords": "113.714015,22.017014", "category": "food" },
  { "map_name": "东发海鲜酒家", "amap_name": "东发海鲜酒家", "coords": "113.715075,22.020275", "category": "food" },
  { "map_name": "是旦有愉食堂", "amap_name": "是旦有愉食堂(东澳岛店)", "coords": "113.714420,22.020122", "category": "food" },
  { "map_name": "是旦海鲜餐厅", "amap_name": "是旦海鲜餐厅总店", "coords": "113.713932,22.018573", "category": "food" },
  { "map_name": "潮汐咖啡", "amap_name": "潮汐咖啡", "coords": "113.715475,22.020075", "category": "food" },
  { "map_name": "精致拾光", "amap_name": "精致拾光", "coords": "113.714515,22.019481", "category": "food" },
  { "map_name": "聚鲜楼", "amap_name": "聚鲜楼·东澳岛酒楼·海鲜加工", "coords": "113.714792,22.019740", "category": "food" },
  { "map_name": "东澳岛游客服务中心", "amap_name": "东澳岛游客服务中心", "coords": "113.715672,22.020272", "category": "shop" },
];

exports.main = async () => {
  // 确保集合存在
  try {
    await db.createCollection('spots');
    console.log('[INIT] spots 集合已创建');
  } catch (e) {
    // 集合已存在时会抛错，忽略
    console.log('[INIT] spots 集合已存在（或创建失败）:', e.message);
  }

  // dongaoGenerate 每次生成都会写一张卡片到 dongaoCards；
  // 集合不存在时写入会报 -502005 并被静默吞掉，所以这里顺手建上。
  try {
    await db.createCollection('dongaoCards');
    console.log('[INIT] dongaoCards 集合已创建');
  } catch (e) {
    console.log('[INIT] dongaoCards 集合已存在（或创建失败）:', e.message);
  }

  const collection = db.collection('spots');
  let inserted = 0, skipped = 0;

  for (const entry of SPOTS_DATA) {
    const [lng, lat] = (entry.coords || '').split(',').map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.warn(`[SKIP] invalid coords: ${entry.map_name}`);
      skipped++;
      continue;
    }

    try {
      const existing = await collection.where({ map_name: entry.map_name }).count();
      if (existing.total > 0) {
        console.log(`[SKIP] exists: ${entry.map_name}`);
        skipped++;
        continue;
      }

      await collection.add({
        data: {
          map_name: entry.map_name,
          amap_name: entry.amap_name || '',
          coords: entry.coords,
          category: entry.category || 'spot',
          location: db.Geo.Point(lng, lat),
        },
      });
      console.log(`[OK] ${entry.map_name}`);
      inserted++;
    } catch (err) {
      console.error(`[FAIL] ${entry.map_name}: ${err.message}`);
      skipped++;
    }
  }

  // wx-server-sdk 没有创建索引的接口（db.command 是操作符对象，不是函数），
  // 所以地理索引只能由控制台或 CLI 管理，本函数不再做无效尝试。
  // 换新环境时必须手动补建一次，否则 dongaoRecommend 的 geoNear 查询无索引：
  //   云开发控制台 → 数据库 → spots → 索引管理 → location 字段，地理位置索引。
  console.log('[INDEX] location 2dsphere 索引由控制台/CLI 维护（本环境索引名：经纬度）');

  return { inserted, skipped, total: SPOTS_DATA.length };
};

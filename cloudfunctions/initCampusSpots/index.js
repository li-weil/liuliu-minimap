const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 中山大学珠海校区 29 个点位（与 campus-data/spots.json 一致，GCJ-02）
const SPOTS_DATA = [
  { "map_name": "教学楼A区", "amap_name": "中山大学珠海校区教学楼A区", "coords": "113.589140,22.346977", "tags": ["景点"], "category": "建筑", "group": "公共教学楼", "openHours": "", "intro": "亚洲最长教学楼最南段，A 区架空层有瑞幸和糖水铺。" },
  { "map_name": "教学楼B区", "amap_name": "中山大学珠海校区教学楼B区", "coords": "113.589060,22.347297", "tags": ["景点"], "category": "建筑", "group": "公共教学楼", "openHours": "", "intro": "公共教学楼南段，日常上课集中区。" },
  { "map_name": "教学楼C区", "amap_name": "中山大学珠海校区教学楼C区", "coords": "113.588878,22.348081", "tags": ["景点"], "category": "建筑", "group": "公共教学楼", "openHours": "", "intro": "公共教学楼中段，长走廊串联南北。" },
  { "map_name": "教学楼D区", "amap_name": "中山大学珠海校区教学楼D区", "coords": "113.588892,22.348657", "tags": ["景点"], "category": "建筑", "group": "公共教学楼", "openHours": "", "intro": "公共教学楼中北段，跨区上课必经连廊。" },
  { "map_name": "教学楼E区", "amap_name": "中山大学珠海校区教学楼E区", "coords": "113.588940,22.349633", "tags": ["景点"], "category": "建筑", "group": "公共教学楼", "openHours": "", "intro": "公共教学楼北段，靠近瀚林楼群。" },
  { "map_name": "教学楼F区", "amap_name": "中山大学珠海校区教学楼F区", "coords": "113.588934,22.350091", "tags": ["景点"], "category": "建筑", "group": "公共教学楼", "openHours": "", "intro": "亚洲最长教学楼最北段，出楼就是生活区方向。" },
  { "map_name": "图书馆", "amap_name": "中山大学珠海校区图书馆", "coords": "113.589166,22.344125", "tags": ["景点"], "category": "场馆", "group": "", "openHours": "", "intro": "珠海校区图书馆，教学楼南侧，自习与借阅主馆。" },
  { "map_name": "体育馆", "amap_name": "中山大学珠海校区体育馆", "coords": "113.592328,22.349502", "tags": ["景点"], "category": "场馆", "group": "", "openHours": "", "intro": "珠海校区综合体育馆，极简建筑风格，室内球类场馆。" },
  { "map_name": "海琴楼群", "amap_name": "中山大学珠海校区海琴楼群", "coords": "113.593973,22.344893", "tags": ["景点", "历史"], "category": "建筑", "group": "", "openHours": "", "intro": "红墙绿瓦新院系楼群，海洋、大气、地科等学院入驻。" },
  { "map_name": "地质矿物博物馆", "amap_name": "中山大学珠海校区地质矿物博物馆", "coords": "113.594456,22.344964", "tags": ["景点", "历史"], "category": "场馆", "group": "", "openHours": "", "intro": "海琴4号楼3层，藏有地质矿物标本的校内博物馆。" },
  { "map_name": "珠海海洋科普中心", "amap_name": "珠海海洋科普中心", "coords": "113.593859,22.344851", "tags": ["景点", "历史"], "category": "场馆", "group": "", "openHours": "周末、国家法定节假日及寒暑假开放个人预约（以官方小程序为准），每周一闭馆；定时免费讲解 10:00、11:00、15:00、16:00", "intro": "海琴4号楼2-3层，2025年开馆的海洋主题科普展馆。" },
  { "map_name": "天琴中心", "amap_name": "中山大学天琴中心", "coords": "113.576852,22.350874", "tags": ["景点", "历史"], "category": "建筑", "group": "", "openHours": "", "intro": "天琴计划引力波探测科研中心，'上天入海'的标志。" },
  { "map_name": "瀚林楼群", "amap_name": "中山大学珠海校区瀚林楼群", "coords": "113.584061,22.349319", "tags": ["景点"], "category": "建筑", "group": "", "openHours": "", "intro": "瀚林1-5号楼，教学楼北侧的楼群。" },
  { "map_name": "海滨红楼", "amap_name": "中山大学珠海校区红楼", "coords": "113.584275,22.349875", "tags": ["历史", "景点"], "category": "建筑", "group": "", "openHours": "", "intro": "红砖办公实验区，延续康乐园红楼传统。" },
  { "map_name": "音乐厅", "amap_name": "中山大学珠海校区音乐厅", "coords": "113.587581,22.346047", "tags": ["景点"], "category": "场馆", "group": "", "openHours": "", "intro": "校区音乐厅，演出与文化活动场地。" },
  { "map_name": "国际交流中心", "amap_name": "中山大学珠海校区国际交流中心", "coords": "113.593835,22.341965", "tags": ["景点"], "category": "场馆", "group": "", "openHours": "", "intro": "校区国际交流与学术活动场地。" },
  { "map_name": "隐湖", "amap_name": "中山大学珠海校区隐湖", "coords": "113.587902,22.347917", "tags": ["景点"], "category": "自然", "group": "", "openHours": "", "intro": "教学楼旁的水景湖，傍晚散步好去处。" },
  { "map_name": "琴湖", "amap_name": "中山大学珠海校区琴湖", "coords": "113.577833,22.351345", "tags": ["景点"], "category": "自然", "group": "", "openHours": "", "intro": "校区西北侧水景，靠近天琴中心方向。" },
  { "map_name": "若海", "amap_name": "中山大学珠海校区若海", "coords": "113.591699,22.345391", "tags": ["景点"], "category": "自然", "group": "", "openHours": "", "intro": "校区南部水景，若海餐厅旁。" },
  { "map_name": "若海餐厅", "amap_name": "中山大学珠海校区若海餐厅", "coords": "113.592110,22.342561", "tags": ["美食", "景点"], "category": "餐饮", "group": "", "openHours": "", "intro": "南门附近的新食堂，环境好。" },
  { "map_name": "槿园食堂", "amap_name": "中山大学珠海校区槿园食堂", "coords": "113.592260,22.350406", "tags": ["美食"], "category": "餐饮", "group": "", "openHours": "", "intro": "槿园宿舍区食堂，周边有糖水和轻食。" },
  { "map_name": "榕园食堂", "amap_name": "榕园食堂", "coords": "113.582597,22.351601", "tags": ["美食"], "category": "餐饮", "group": "", "openHours": "", "intro": "榕园宿舍区食堂，靠近榕园广场。" },
  { "map_name": "荔园食堂", "amap_name": "中山大学珠海校区荔园食堂", "coords": "113.587655,22.351922", "tags": ["美食"], "category": "餐饮", "group": "", "openHours": "", "intro": "荔园13号楼食堂，二层有肯德基。" },
  { "map_name": "教学楼咖啡饮品", "amap_name": "瑞幸咖啡(中山大学珠海校区店)", "coords": "113.589126,22.347081", "tags": ["美食"], "category": "餐饮", "group": "", "openHours": "", "intro": "教学楼A区架空层，瑞幸+满忆糖水，课间补给站。" },
  { "map_name": "荔园咖啡饮品", "amap_name": "瑞幸咖啡(中山大学珠海校区荔园店)", "coords": "113.585257,22.350862", "tags": ["美食"], "category": "餐饮", "group": "", "openHours": "", "intro": "荔园10号楼二层瑞幸，宿舍区咖啡。" },
  { "map_name": "孙中山铜像", "amap_name": "中山大学珠海校区孙中山铜像", "coords": "113.590419,22.349362", "tags": ["历史"], "category": "纪念", "group": "", "openHours": "", "intro": "校园中轴上的孙中山先生铜像。" },
  { "map_name": "校训石", "amap_name": "中山大学珠海校区校训石", "coords": "113.590747,22.348778", "tags": ["历史"], "category": "纪念", "group": "", "openHours": "", "intro": "刻有校训的景观石，与铜像相邻。" },
  { "map_name": "槿园运动场", "amap_name": "中山大学珠海校区槿园运动场", "coords": "113.590238,22.351151", "tags": ["景点"], "category": "运动", "group": "", "openHours": "", "intro": "槿园旁的运动场地，跑步踢球都方便。" },
  { "map_name": "游泳池", "amap_name": "中山大学珠海校区游泳池", "coords": "113.579812,22.350437", "tags": ["景点"], "category": "运动", "group": "", "openHours": "", "intro": "校区室外游泳池，夏季开放。" }
];

exports.main = async () => {
  // 确保集合存在
  try {
    await db.createCollection('campusSpots');
    console.log('[INIT] campusSpots 集合已创建');
  } catch (e) {
    console.log('[INIT] campusSpots 集合已存在（或创建失败）:', e.message);
  }

  const collection = db.collection('campusSpots');
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
          tags: Array.isArray(entry.tags) ? entry.tags : [],
          category: entry.category || '',
          group: entry.group || '',
          openHours: entry.openHours || '',
          intro: entry.intro || '',
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

  // Create geo index
  try {
    await db.command({
      createIndexes: 'campusSpots',
      indexes: [{ key: { location: '2dsphere' }, name: 'location_geo' }],
    });
    console.log('[INDEX] geo index created on location');
  } catch (e) {
    try {
      await collection.createIndex({ location: '2dsphere' });
      console.log('[INDEX] geo index created (fallback)');
    } catch (e2) {
      console.error('[INDEX] createIndex failed:', e.message, '| fallback:', e2.message);
      console.error('[INDEX] 请在云开发控制台 → 数据库 → campusSpots → 索引管理 → 新建索引: location 字段, 地理位置索引');
    }
  }

  return { inserted, skipped, total: SPOTS_DATA.length };
};

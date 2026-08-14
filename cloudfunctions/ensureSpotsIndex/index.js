const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const collection = db.collection('spots');

  // 方法1: 标准 createIndex
  try {
    await collection.createIndex({ keys: { location: '2dsphere' }, name: 'location_geo' });
    return { ok: true, method: 'createIndex', index: 'location_geo' };
  } catch (e1) {
    console.warn('createIndex failed:', e1.message);

    // 方法2: db.command 方式
    try {
      await db.command({
        createIndexes: 'spots',
        indexes: [{ key: { location: '2dsphere' }, name: 'location_geo', background: true }],
      });
      return { ok: true, method: 'db.command', index: 'location_geo' };
    } catch (e2) {
      console.warn('db.command failed:', e2.message);
      throw new Error(
        '无法自动创建geo索引，请手动操作：云开发控制台 → 数据库 → spots → 索引管理 → 新建 → 字段:location 类型:地理位置'
      );
    }
  }
};

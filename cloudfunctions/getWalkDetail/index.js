const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const id = event.id;
  if (!id) {
    return { walk: null, reason: 'missing_id' };
  }

  const doc = await db.collection('walkRecords').doc(id).get();
  const walk = doc.data;
  if (!walk) {
    return { walk: null, reason: 'not_found' };
  }

  if (walk.userId !== wxContext.OPENID && !walk.isPublic) {
    throw new Error('permission_denied');
  }

  return { walk };
};

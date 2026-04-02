const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const id = event.id;

  if (!id) {
    return { ok: false, reason: 'missing_id' };
  }

  let walk = null;
  try {
    const doc = await db.collection('walkRecords').doc(id).get();
    walk = doc.data || null;
  } catch (error) {
    return { ok: false, reason: 'not_found' };
  }

  if (!walk) {
    return { ok: false, reason: 'not_found' };
  }

  if (walk.userId !== wxContext.OPENID) {
    return { ok: false, reason: 'permission_denied' };
  }

  try {
    await db.collection('walkRecords').doc(id).remove();
  } catch (error) {
    return { ok: false, reason: 'delete_failed' };
  }

  return {
    ok: true,
    id,
  };
};

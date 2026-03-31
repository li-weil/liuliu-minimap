const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const id = event.id;

  if (!id) {
    return { ok: false, reason: 'missing_id' };
  }

  const doc = await db.collection('walkRecords').doc(id).get();
  const walk = doc.data;

  if (!walk) {
    return { ok: false, reason: 'not_found' };
  }

  if (walk.userId !== wxContext.OPENID) {
    throw new Error('permission_denied');
  }

  await db.collection('walkRecords').doc(id).update({
    data: {
      isPublic: true,
      sharedAt: Date.now(),
    },
  });

  const updated = await db.collection('walkRecords').doc(id).get();
  return {
    ok: true,
    walk: updated.data,
  };
};

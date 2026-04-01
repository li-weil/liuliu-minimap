const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const collection = db.collection('users');
  const action = event.action || 'sync';
  const incomingProfile = event.profile && typeof event.profile === 'object'
    ? event.profile
    : event;
  const profile = {
    nickName: String(incomingProfile.nickName || '').trim(),
    avatarUrl: incomingProfile.avatarUrl || '',
  };

  if (!openid) {
    throw new Error('missing_openid');
  }

  if (action === 'get') {
    try {
      const userDoc = await collection.doc(openid).get();
      return {
        loggedIn: !!(userDoc && userDoc.data),
        user: userDoc && userDoc.data ? userDoc.data : null,
        openid,
      };
    } catch (error) {
      return {
        loggedIn: false,
        user: null,
        openid,
      };
    }
  }

  try {
    await collection.doc(openid).get();
    await collection.doc(openid).update({
      data: {
        nickName: profile.nickName || '微信用户',
        avatarUrl: profile.avatarUrl || '',
        lastLoginAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
  } catch (error) {
    await collection.doc(openid).set({
      data: {
        openid,
        nickName: profile.nickName || '微信用户',
        avatarUrl: profile.avatarUrl || '',
        role: 'user',
        createdAt: db.serverDate(),
        lastLoginAt: db.serverDate(),
        updatedAt: db.serverDate(),
      },
    });
  }

  const userDoc = await collection.doc(openid).get();
  return {
    loggedIn: true,
    user: userDoc.data,
    openid,
  };
};

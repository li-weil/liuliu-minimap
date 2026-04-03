const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

async function getUserProfile(openid) {
  try {
    const result = await db.collection('users').doc(openid).get();
    return result.data || null;
  } catch (error) {
    return null;
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    throw new Error('missing_openid');
  }

  const themeSnapshot = event.themeSnapshot || {};
  const missions = Array.isArray(themeSnapshot.missions) ? themeSnapshot.missions.filter(Boolean) : [];
  if (!missions.length) {
    throw new Error('missing_missions');
  }

  const user = await getUserProfile(openid);
  const now = Date.now();
  const roomPayload = {
    ownerUserId: openid,
    status: 'waiting',
    walkMode: event.walkMode || 'pure',
    themeSnapshot,
    themeTitle: event.themeTitle || themeSnapshot.title || '同行漫步',
    themeCategory: themeSnapshot.category || '',
    locationName: event.locationName || '当前位置',
    locationContext: event.locationContext || '',
    locationAddress: event.locationAddress || '',
    latitude: event.latitude !== undefined ? event.latitude : null,
    longitude: event.longitude !== undefined ? event.longitude : null,
    season: event.season || '',
    generationContext: event.generationContext || {},
    memberCount: 1,
    teamStats: {
      memberCount: 1,
      contributionCount: 0,
      completedMissionCount: 0,
      totalMissionCount: missions.length,
      photoCount: 0,
      videoCount: 0,
      audioCount: 0,
    },
    teamSummary: '',
    coverImage: '',
    createdAt: now,
    startedAt: null,
    endedAt: null,
  };

  const roomResult = await db.collection('teamWalkRooms').add({ data: roomPayload });
  const roomId = roomResult._id;
  const memberPayload = {
    roomId,
    userId: openid,
    nickName: user && user.nickName ? user.nickName : '微信用户',
    avatarUrl: user && user.avatarUrl ? user.avatarUrl : '',
    role: 'owner',
    status: 'joined',
    joinedAt: now,
    createdAt: now,
  };

  await db.collection('teamWalkMembers').add({ data: memberPayload });
  await db.collection('teamWalkActivities').add({
    data: {
      roomId,
      type: 'room_created',
      userId: openid,
      nickName: memberPayload.nickName,
      avatarUrl: memberPayload.avatarUrl,
      content: `${memberPayload.nickName} 发起了同行漫步`,
      payload: {
        themeTitle: roomPayload.themeTitle,
      },
      createdAt: now,
    },
  });

  return {
    roomId,
    room: {
      _id: roomId,
      ...roomPayload,
      members: [memberPayload],
      contributions: [],
      activities: [],
      memberRole: 'owner',
    },
  };
};

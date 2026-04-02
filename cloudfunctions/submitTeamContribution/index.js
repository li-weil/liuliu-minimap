const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function countMedia(contributions) {
  return (contributions || []).reduce((result, item) => {
    result.photoCount += Array.isArray(item.photoList) ? item.photoList.length : 0;
    result.videoCount += Array.isArray(item.videoList) ? item.videoList.length : 0;
    result.audioCount += Array.isArray(item.audioList) ? item.audioList.length : 0;
    return result;
  }, {
    photoCount: 0,
    videoCount: 0,
    audioCount: 0,
  });
}

async function computeTeamStats(roomId, room) {
  const membersResult = await db.collection('teamWalkMembers').where({ roomId, status: 'joined' }).get();
  const contributionsResult = await db.collection('teamWalkContributions').where({ roomId }).get();
  const contributions = contributionsResult.data || [];
  const completedMissionSet = new Set(contributions.filter((item) => item.completed).map((item) => item.missionKey));
  const mediaStats = countMedia(contributions);
  return {
    memberCount: (membersResult.data || []).length,
    contributionCount: contributions.length,
    completedMissionCount: completedMissionSet.size,
    totalMissionCount: Array.isArray(room.themeSnapshot && room.themeSnapshot.missions) ? room.themeSnapshot.missions.length : 0,
    photoCount: mediaStats.photoCount,
    videoCount: mediaStats.videoCount,
    audioCount: mediaStats.audioCount,
  };
}

async function getRoomBundle(roomId, openid) {
  const roomDoc = await db.collection('teamWalkRooms').doc(roomId).get();
  const room = roomDoc.data;
  const membersResult = await db.collection('teamWalkMembers').where({ roomId, status: 'joined' }).get();
  const contributionsResult = await db.collection('teamWalkContributions').where({ roomId }).orderBy('updatedAt', 'desc').get();
  const activitiesResult = await db.collection('teamWalkActivities').where({ roomId }).orderBy('createdAt', 'desc').limit(20).get();
  const member = (membersResult.data || []).find((item) => item.userId === openid) || null;
  return {
    _id: roomId,
    ...room,
    members: membersResult.data || [],
    contributions: contributionsResult.data || [],
    activities: activitiesResult.data || [],
    memberRole: member ? member.role : '',
  };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const roomId = event.roomId || event.id;
  if (!roomId) {
    throw new Error('missing_room_id');
  }
  if (!event.missionKey) {
    throw new Error('missing_mission_key');
  }

  const roomDoc = await db.collection('teamWalkRooms').doc(roomId).get();
  const room = roomDoc.data;
  if (!room) {
    throw new Error('room_not_found');
  }
  if (room.status !== 'active') {
    throw new Error('room_not_active');
  }

  const memberResult = await db.collection('teamWalkMembers').where({ roomId, userId: openid, status: 'joined' }).limit(1).get();
  if (!(memberResult.data && memberResult.data.length)) {
    throw new Error('permission_denied');
  }
  const member = memberResult.data[0];
  const now = Date.now();
  const contributionsCollection = db.collection('teamWalkContributions');
  const existingResult = await contributionsCollection.where({ roomId, userId: openid, missionKey: event.missionKey }).limit(1).get();
  const existing = existingResult.data && existingResult.data[0] ? existingResult.data[0] : null;
  const nextPayload = {
    roomId,
    missionKey: event.missionKey,
    missionLabel: event.missionLabel || event.missionKey,
    userId: openid,
    nickName: member.nickName || '微信用户',
    avatarUrl: member.avatarUrl || '',
    noteText: event.noteText || '',
    photoList: Array.isArray(event.photoList) ? event.photoList.filter(Boolean) : [],
    videoList: Array.isArray(event.videoList) ? event.videoList.filter(Boolean) : [],
    audioList: Array.isArray(event.audioList) ? event.audioList.filter(Boolean) : [],
    completed: !!event.completed,
    createdAt: existing ? existing.createdAt || now : now,
    updatedAt: now,
  };

  let contributionId = '';
  if (existing) {
    contributionId = existing._id;
    await contributionsCollection.doc(existing._id).update({ data: nextPayload });
  } else {
    const addResult = await contributionsCollection.add({ data: nextPayload });
    contributionId = addResult._id;
  }

  const nextStats = await computeTeamStats(roomId, room);
  const coverImage = nextPayload.photoList[0] || room.coverImage || '';
  await db.collection('teamWalkRooms').doc(roomId).update({
    data: {
      teamStats: nextStats,
      coverImage,
    },
  });
  await db.collection('teamWalkActivities').add({
    data: {
      roomId,
      type: 'mission_updated',
      userId: openid,
      nickName: member.nickName || '队友',
      avatarUrl: member.avatarUrl || '',
      content: nextPayload.completed
        ? `${member.nickName || '队友'} 完成了「${nextPayload.missionLabel}」`
        : `${member.nickName || '队友'} 更新了「${nextPayload.missionLabel}」的记录`,
      payload: {
        missionKey: nextPayload.missionKey,
        missionLabel: nextPayload.missionLabel,
        completed: nextPayload.completed,
      },
      createdAt: now,
    },
  });

  return {
    ok: true,
    contribution: {
      _id: contributionId,
      ...nextPayload,
    },
    room: await getRoomBundle(roomId, openid),
  };
};

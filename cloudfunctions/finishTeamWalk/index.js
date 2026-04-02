const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function buildSummary(room, members, contributions) {
  const completedMissionSet = new Set(contributions.filter((item) => item.completed).map((item) => item.missionKey));
  const memberNames = members.map((item) => item.nickName || '队友').filter(Boolean);
  const mediaCount = contributions.reduce((total, item) => {
    return total
      + (Array.isArray(item.photoList) ? item.photoList.length : 0)
      + (Array.isArray(item.videoList) ? item.videoList.length : 0)
      + (Array.isArray(item.audioList) ? item.audioList.length : 0);
  }, 0);
  return `${memberNames.join('、')} 在 ${room.locationName || '这片街区'} 一起完成了 ${completedMissionSet.size} 个任务，留下了 ${mediaCount} 份同行记录。`;
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
  const roomId = event.roomId || event.id;
  const openid = wxContext.OPENID;
  if (!roomId) {
    throw new Error('missing_room_id');
  }

  const roomDoc = await db.collection('teamWalkRooms').doc(roomId).get();
  const room = roomDoc.data;
  if (!room) {
    throw new Error('room_not_found');
  }
  if (room.ownerUserId !== openid) {
    throw new Error('permission_denied');
  }
  if (room.status !== 'active') {
    throw new Error('room_not_active');
  }

  const membersResult = await db.collection('teamWalkMembers').where({ roomId, status: 'joined' }).get();
  const contributionsResult = await db.collection('teamWalkContributions').where({ roomId }).get();
  const members = membersResult.data || [];
  const contributions = contributionsResult.data || [];
  const completedMissionSet = new Set(contributions.filter((item) => item.completed).map((item) => item.missionKey));
  const teamStats = {
    memberCount: members.length,
    contributionCount: contributions.length,
    completedMissionCount: completedMissionSet.size,
    totalMissionCount: Array.isArray(room.themeSnapshot && room.themeSnapshot.missions) ? room.themeSnapshot.missions.length : 0,
    photoCount: contributions.reduce((total, item) => total + (Array.isArray(item.photoList) ? item.photoList.length : 0), 0),
    videoCount: contributions.reduce((total, item) => total + (Array.isArray(item.videoList) ? item.videoList.length : 0), 0),
    audioCount: contributions.reduce((total, item) => total + (Array.isArray(item.audioList) ? item.audioList.length : 0), 0),
  };
  const now = Date.now();
  const teamSummary = buildSummary(room, members, contributions);
  const firstContributionWithPhoto = contributions.find((item) => Array.isArray(item.photoList) && item.photoList.length);
  await db.collection('teamWalkRooms').doc(roomId).update({
    data: {
      status: 'finished',
      endedAt: now,
      teamStats,
      teamSummary,
      coverImage: room.coverImage || (firstContributionWithPhoto && firstContributionWithPhoto.photoList ? firstContributionWithPhoto.photoList[0] : '') || '',
    },
  });
  const owner = members.find((item) => item.userId === openid) || null;
  await db.collection('teamWalkActivities').add({
    data: {
      roomId,
      type: 'walk_finished',
      userId: openid,
      nickName: owner && owner.nickName ? owner.nickName : '房主',
      avatarUrl: owner && owner.avatarUrl ? owner.avatarUrl : '',
      content: `${owner && owner.nickName ? owner.nickName : '房主'} 结束了同行漫步`,
      payload: {
        completedMissionCount: teamStats.completedMissionCount,
      },
      createdAt: now,
    },
  });

  return {
    ok: true,
    room: await getRoomBundle(roomId, openid),
  };
};

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function sanitizeContributionForDisplay(item) {
  const photoList = Array.isArray(item && item.photoList) ? item.photoList.filter(Boolean) : [];
  const videoList = Array.isArray(item && item.videoList) ? item.videoList.filter(Boolean) : [];
  const audioList = Array.isArray(item && item.audioList) ? item.audioList.filter(Boolean) : [];
  return {
    ...item,
    noteText: item && item.textAuditStatus === 'approved' ? item.noteText || '' : '',
    photoList,
    photoCount: item && item.photoCount !== undefined ? item.photoCount : photoList.length,
    photoAuditStatus: item && item.photoAuditStatus ? item.photoAuditStatus : (photoList.length ? 'pending' : 'approved'),
    videoList,
    videoCount: item && item.videoCount !== undefined ? item.videoCount : videoList.length,
    videoAuditStatus: item && item.videoAuditStatus ? item.videoAuditStatus : (videoList.length ? 'pending' : 'approved'),
    audioList,
    audioCount: item && item.audioCount !== undefined ? item.audioCount : audioList.length,
    audioAuditStatus: item && item.audioAuditStatus ? item.audioAuditStatus : (audioList.length ? 'pending' : 'approved'),
  };
}

async function getRoomBundle(roomId, openid) {
  const roomDoc = await db.collection('teamWalkRooms').doc(roomId).get();
  const room = roomDoc.data;
  if (!room) {
    throw new Error('room_not_found');
  }

  const membersResult = await db.collection('teamWalkMembers')
    .where({ roomId, status: 'joined' })
    .orderBy('joinedAt', 'asc')
    .get();
  const contributionsResult = await db.collection('teamWalkContributions')
    .where({ roomId })
    .orderBy('updatedAt', 'desc')
    .get();
  const activitiesResult = await db.collection('teamWalkActivities')
    .where({ roomId })
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();

  const memberDocs = membersResult.data || [];
  const member = memberDocs.find((item) => item.userId === openid) || null;
  const contributionDocs = contributionsResult.data || [];
  const activityDocs = activitiesResult.data || [];
  const teamStats = room.teamStats || {};
  const safeTeamStats = {
    ...teamStats,
    memberCount: teamStats.memberCount || memberDocs.length,
    contributionCount: teamStats.contributionCount || contributionDocs.length,
  };

  if (!member) {
    return {
      _id: roomId,
      ...room,
      members: [],
      contributions: [],
      activities: [],
      teamStats: safeTeamStats,
      memberRole: '',
      canPreview: true,
    };
  }

  return {
    _id: roomId,
    ...room,
    members: memberDocs,
    contributions: contributionDocs.map((item) => sanitizeContributionForDisplay(item)),
    activities: activityDocs,
    teamStats: safeTeamStats,
    memberRole: member.role || '',
  };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const roomId = event.roomId || event.id;
  if (!roomId) {
    throw new Error('missing_room_id');
  }

  return {
    room: await getRoomBundle(roomId, wxContext.OPENID),
  };
};

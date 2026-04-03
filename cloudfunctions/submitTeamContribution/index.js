const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const companionNoteJobs = db.collection('companionNoteJobs');
const TEXT_RISK_PATTERN = /(?:加微|加v|vx|v信|微信号|qq|扣扣|色情网|裸聊|约炮|招嫖|嫖娼|赌博|博彩|彩票|刷单|返利|代开发票|办证|毒品|冰毒|海洛因|枪支|炸药)/i;
const CONTENT_MAX_LENGTH = 300;

async function enqueueCompanionNoteJob({ roomId, missionKey, openid }) {
  if (!roomId || !missionKey || !openid) {
    return;
  }
  const now = Date.now();
  const dedupeKey = `team:${roomId}:${openid}:${missionKey}`;
  const existingResult = await companionNoteJobs.where({ dedupeKey }).limit(1).get();
  const existing = existingResult.data && existingResult.data[0] ? existingResult.data[0] : null;
  const payload = {
    dedupeKey,
    type: 'team',
    status: 'pending',
    payload: {
      roomId,
      missionKey,
      openid,
    },
    attempts: 0,
    lastError: '',
    nextRunAt: now,
    updatedAt: now,
  };
  if (existing) {
    await companionNoteJobs.doc(existing._id).update({
      data: {
        ...payload,
        createdAt: existing.createdAt || now,
      },
    });
    return;
  }
  await companionNoteJobs.add({
    data: {
      ...payload,
      createdAt: now,
    },
  });
}

function normalizeText(value, maxLength = CONTENT_MAX_LENGTH) {
  return String(value || '').trim().slice(0, maxLength);
}

function isContentSecurityRejected(error) {
  const message = String((error && error.message) || (error && error.errMsg) || '').toLowerCase();
  return (
    message.includes('risky') ||
    message.includes('content violate') ||
    message.includes('content security') ||
    message.includes('msgseccheck') ||
    message.includes('errcode: 87014') ||
    message.includes('errcode:87014')
  );
}

function shouldSkipCloudSecurity(error) {
  const message = String((error && error.message) || (error && error.errMsg) || '').toLowerCase();
  return (
    message.includes('msgseccheck is not a function') ||
    message.includes('openapi') ||
    message.includes('api unsupported') ||
    message.includes('invalid scope') ||
    message.includes('not available')
  );
}

async function ensureSafeTextContent(content, label) {
  const normalized = normalizeText(content);
  if (!normalized) {
    return '';
  }
  if (TEXT_RISK_PATTERN.test(normalized)) {
    throw new Error(`${label}_risky`);
  }

  if (
    cloud.openapi &&
    cloud.openapi.security &&
    typeof cloud.openapi.security.msgSecCheck === 'function'
  ) {
    try {
      await cloud.openapi.security.msgSecCheck({ content: normalized });
    } catch (error) {
      if (isContentSecurityRejected(error)) {
        throw new Error(`${label}_risky`);
      }
      if (!shouldSkipCloudSecurity(error)) {
        throw error;
      }
    }
  }

  return normalized;
}

function normalizeMediaList(list) {
  return Array.isArray(list) ? list.filter(Boolean) : [];
}

function buildMediaAuditStatus(list) {
  return normalizeMediaList(list).length ? 'approved' : 'approved';
}

function sanitizeContributionForDisplay(item) {
  const photoList = normalizeMediaList(item && item.photoList);
  const videoList = normalizeMediaList(item && item.videoList);
  const audioList = normalizeMediaList(item && item.audioList);
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
    companionNote: item && item.companionNote ? item.companionNote : '',
  };
}

function countMedia(contributions) {
  return (contributions || []).reduce((result, item) => {
    result.photoCount += item.photoAuditStatus === 'approved' && Array.isArray(item.photoList) ? item.photoList.length : 0;
    result.videoCount += item.videoAuditStatus === 'approved' && Array.isArray(item.videoList) ? item.videoList.length : 0;
    result.audioCount += item.audioAuditStatus === 'approved' && Array.isArray(item.audioList) ? item.audioList.length : 0;
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
    contributions: (contributionsResult.data || []).map((item) => sanitizeContributionForDisplay(item)),
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
  const safeNickName = await ensureSafeTextContent(member.nickName || '微信用户', 'nickname');
  const safeNoteText = await ensureSafeTextContent(event.noteText || '', 'note_text');
  const photoList = normalizeMediaList(event.photoList);
  const videoList = normalizeMediaList(event.videoList);
  const audioList = normalizeMediaList(event.audioList);
  const nextPayload = {
    roomId,
    missionKey: event.missionKey,
    missionLabel: event.missionLabel || event.missionKey,
    userId: openid,
    nickName: safeNickName || '微信用户',
    avatarUrl: member.avatarUrl || '',
    noteText: safeNoteText,
    textAuditStatus: 'approved',
    photoList,
    photoCount: photoList.length,
    photoAuditStatus: buildMediaAuditStatus(photoList),
    videoList,
    videoCount: videoList.length,
    videoAuditStatus: buildMediaAuditStatus(videoList),
    audioList,
    audioCount: audioList.length,
    audioAuditStatus: buildMediaAuditStatus(audioList),
    companionNote: normalizeText(event.companionNote || '', 200),
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
      nickName: safeNickName || '队友',
      avatarUrl: member.avatarUrl || '',
      content: nextPayload.completed
        ? `${safeNickName || '队友'} 完成了「${nextPayload.missionLabel}」`
        : `${safeNickName || '队友'} 更新了「${nextPayload.missionLabel}」的记录`,
      payload: {
        missionKey: nextPayload.missionKey,
        missionLabel: nextPayload.missionLabel,
        completed: nextPayload.completed,
      },
      createdAt: now,
    },
  });

  await enqueueCompanionNoteJob({
    roomId,
    missionKey: nextPayload.missionKey,
    openid,
  });

  return {
    ok: true,
    contribution: sanitizeContributionForDisplay({
      _id: contributionId,
      ...nextPayload,
    }),
    room: await getRoomBundle(roomId, openid),
  };
};

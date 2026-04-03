const cloud = require('wx-server-sdk');
const { recalculateUserAchievements } = require('./achievement');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const now = Date.now();
  const status = event.status || 'finished';
  const walkId = event.id || event.walkId || '';

  const payload = {
    userId: wxContext.OPENID,
    themeTitle: event.themeSnapshot.title,
    themeSnapshot: event.themeSnapshot,
    locationName: event.locationName || '当前位置',
    locationContext: event.locationContext || '',
    locationAddress: event.locationAddress || '',
    latitude: event.latitude !== undefined ? event.latitude : null,
    longitude: event.longitude !== undefined ? event.longitude : null,
    routePoints: event.routePoints || [],
    missionsCompleted: event.missionsCompleted || [],
    missionReviews: event.missionReviews || {},
    missionAssetMap: event.missionAssetMap || {},
    photoList: event.photoList || [],
    videoList: event.videoList || [],
    audioList: event.audioList || [],
    coverImage: (event.photoList || [])[0] || '',
    noteText: event.noteText || '',
    trackStartedAt: event.trackStartedAt || null,
    trackStoppedAt: event.trackStoppedAt || null,
    routeStats: event.routeStats || {
      durationMs: 0,
      pointCount: Array.isArray(event.routePoints) ? event.routePoints.length : 0,
      distanceMeters: 0,
    },
    sticker: event.sticker || null,
    isPublic: !!event.isPublic,
    walkMode: event.walkMode || 'pure',
    generationSource: event.generationSource || 'unknown',
    season: event.season || '',
    generationContext: event.generationContext || {},
    startedAt: event.startedAt || event.trackStartedAt || now,
    endedAt: status === 'finished' ? (event.endedAt || event.trackStoppedAt || now) : null,
    status,
    updatedAt: now,
  };

  if (walkId) {
    const existingDoc = await db.collection('walkRecords').doc(walkId).get();
    const existing = existingDoc.data;
    if (!existing) {
      throw new Error('walk_not_found');
    }
    if (existing.userId !== wxContext.OPENID) {
      throw new Error('permission_denied');
    }

    await db.collection('walkRecords').doc(walkId).update({
      data: {
        ...payload,
        createdAt: existing.createdAt || now,
        startedAt: existing.startedAt || payload.startedAt,
        endedAt: status === 'finished' ? payload.endedAt : null,
      },
    });
    const updatedDoc = await db.collection('walkRecords').doc(walkId).get();
    const achievementState = status === 'finished'
      ? await recalculateUserAchievements({
          db,
          _,
          openid: wxContext.OPENID,
        })
      : null;
    return { ok: true, id: walkId, walk: updatedDoc.data, achievements: achievementState };
  }

  payload.createdAt = now;
  const result = await db.collection('walkRecords').add({ data: payload });
  const createdDoc = await db.collection('walkRecords').doc(result._id).get();
  const achievementState = status === 'finished'
    ? await recalculateUserAchievements({
        db,
        _,
        openid: wxContext.OPENID,
      })
    : null;
  return { ok: true, id: result._id, walk: createdDoc.data, achievements: achievementState };
};

const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();

  const payload = {
    userId: wxContext.OPENID,
    themeTitle: event.themeSnapshot.title,
    themeSnapshot: event.themeSnapshot,
    locationName: event.locationName || '当前位置',
    locationContext: event.locationContext || '城市街道',
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
    createdAt: Date.now(),
  };

  const result = await db.collection('walkRecords').add({ data: payload });
  return { ok: true, id: result._id };
};

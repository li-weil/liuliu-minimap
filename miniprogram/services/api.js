const { apiBaseUrl, apiPrefix, requestTimeout, useCloudMediaStorage, useCloudWalkStorage } = require('../utils/config');
const { callCloud, uploadToCloud } = require('./cloud');
const { inferExtension } = require('../utils/media');

const CLOUD_ENDPOINTS = new Set(
  useCloudWalkStorage
    ? ['createWalk', 'listMyWalks', 'listPublicWalks', 'getWalkDetail', 'verifyMission', 'generateSticker', 'generateStickerPlan', 'generateStickerImage', 'generateCompanionNote', 'publishWalkShare', 'deleteWalk', 'saveTeamMissionCard', 'updateTeamMemberDraftState']
    : []
);

function normalizeThemeResponse(data, requestData, source) {
  return {
    theme: data,
    source,
    request: requestData,
  };
}

function normalizeWalkRecord(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const recordId = item._id || item.id || '';
  const completedMissions = Array.isArray(item.completedMissions) ? item.completedMissions : [];
  const missionList = completedMissions
    .map((mission) => {
      if (typeof mission === 'string') {
        return mission;
      }
      return mission && mission.mission ? mission.mission : '';
    })
    .filter(Boolean);
  const routePoints = Array.isArray(item.routePoints)
    ? item.routePoints
        .map((point) => ({
          latitude: point.latitude !== undefined ? point.latitude : point.lat,
          longitude: point.longitude !== undefined ? point.longitude : point.lng,
          timestamp: point.timestamp,
        }))
        .filter((point) => point.latitude !== undefined && point.longitude !== undefined)
    : Array.isArray(item.path)
      ? item.path.map((point) => ({
          latitude: point.lat,
          longitude: point.lng,
          timestamp: point.timestamp,
        }))
      : [];
  const photoList = Array.isArray(item.photoList)
    ? item.photoList.filter(Boolean)
    : item.photoUrl
      ? [item.photoUrl]
      : [];
  const videoList = Array.isArray(item.videoList)
    ? item.videoList.filter(Boolean)
    : item.videoUrl
      ? [item.videoUrl]
      : [];
  const audioList = Array.isArray(item.audioList)
    ? item.audioList.filter(Boolean)
    : item.audioUrl
      ? [item.audioUrl]
      : [];
  const themeSnapshot = item.themeSnapshot || {};
  const missionAssetMap = item.missionAssetMap || {};
  const summaryAssets = missionAssetMap.__summary__ || {};
  const firstMissionAssetWithCard = Object.values(missionAssetMap).find((asset) => asset && asset.cardImagePath);
  const routeStats = item.routeStats || {};
  const durationMs = routeStats.durationMs || 0;
  const distanceMeters = routeStats.distanceMeters || 0;
  const trackStartedAt = item.trackStartedAt || null;
  const trackStoppedAt = item.trackStoppedAt || null;
  const generationContext = item.generationContext || {};
  return {
    _id: recordId,
    id: recordId,
    userId: item.userId || '',
    themeTitle: item.themeTitle || themeSnapshot.title || '',
    themeCategory: item.themeCategory || themeSnapshot.category || '',
    locationName: item.locationName || '未知地点',
    locationContext: item.locationContext || '',
    locationAddress: item.locationAddress || '',
    latitude: item.latitude !== undefined ? item.latitude : null,
    longitude: item.longitude !== undefined ? item.longitude : null,
    noteText: item.noteText || summaryAssets.noteText || '',
    createdAt: item.createdAt || Date.now(),
    updatedAt: item.updatedAt || item.createdAt || Date.now(),
    startedAt: item.startedAt || item.createdAt || null,
    endedAt: item.endedAt || null,
    status: item.status || 'finished',
    trackStartedAt,
    trackStoppedAt,
    routeStats: {
      durationMs,
      pointCount: routeStats.pointCount || routePoints.length,
      distanceMeters,
      durationLabel: formatDuration(durationMs),
      distanceLabel: formatDistance(distanceMeters),
      startedLabel: formatTrackTime(trackStartedAt),
      stoppedLabel: formatTrackTime(trackStoppedAt),
    },
    sticker: item.sticker || null,
    photoList,
    videoList,
    audioList,
    coverImage: item.coverImage || summaryAssets.cardImagePath || summaryAssets.photoList && summaryAssets.photoList[0] || photoList[0] || (firstMissionAssetWithCard && firstMissionAssetWithCard.cardImagePath) || '',
    routePoints,
    completedMissions: missionList,
    missionReviews: item.missionReviews || {},
    missionAssetMap,
    isPublic: !!item.isPublic,
    canDelete: !!recordId && !!item.userId,
    walkMode: item.walkMode || 'pure',
    generationSource: item.generationSource || 'unknown',
    season: item.season || generationContext.season || '',
    generationContext,
    themeSnapshot: {
      ...themeSnapshot,
      title: item.themeTitle || themeSnapshot.title || '',
      category: item.themeCategory || themeSnapshot.category || '',
      description: themeSnapshot.description || item.noteText || '',
      missions: Array.isArray(themeSnapshot.missions) && themeSnapshot.missions.length
        ? themeSnapshot.missions
        : missionList,
    },
  };
}

function normalizeTeamMember(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  return {
    userId: item.userId || '',
    nickName: item.nickName || item.nickname || '微信用户',
    avatarUrl: item.avatarUrl || '',
    role: item.role || 'member',
    status: item.status || 'joined',
    joinedAt: item.joinedAt || item.createdAt || Date.now(),
    pendingMissionKeys: Array.isArray(item.pendingMissionKeys) ? item.pendingMissionKeys.filter(Boolean) : [],
    lastDraftUpdatedAt: item.lastDraftUpdatedAt || 0,
    lastSyncedAt: item.lastSyncedAt || 0,
  };
}

function normalizeTeamContribution(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  return {
    id: item._id || item.id || '',
    roomId: item.roomId || '',
    missionKey: item.missionKey || '',
    missionLabel: item.missionLabel || item.missionKey || '',
    userId: item.userId || '',
    nickName: item.nickName || '微信用户',
    avatarUrl: item.avatarUrl || '',
    noteText: item.noteText || '',
    photoList: Array.isArray(item.photoList) ? item.photoList.filter(Boolean) : [],
    photoCount: item.photoCount !== undefined ? item.photoCount : (Array.isArray(item.photoList) ? item.photoList.length : 0),
    photoAuditStatus: item.photoAuditStatus || 'approved',
    videoList: Array.isArray(item.videoList) ? item.videoList.filter(Boolean) : [],
    videoCount: item.videoCount !== undefined ? item.videoCount : (Array.isArray(item.videoList) ? item.videoList.length : 0),
    videoAuditStatus: item.videoAuditStatus || 'approved',
    audioList: Array.isArray(item.audioList) ? item.audioList.filter(Boolean) : [],
    audioCount: item.audioCount !== undefined ? item.audioCount : (Array.isArray(item.audioList) ? item.audioList.length : 0),
    audioAuditStatus: item.audioAuditStatus || 'approved',
    companionNote: item.companionNote || '',
    textAuditStatus: item.textAuditStatus || 'approved',
    completed: !!item.completed,
    createdAt: item.createdAt || Date.now(),
    updatedAt: item.updatedAt || item.createdAt || Date.now(),
  };
}

function normalizeTeamActivity(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  return {
    id: item._id || item.id || '',
    roomId: item.roomId || '',
    type: item.type || 'unknown',
    userId: item.userId || '',
    nickName: item.nickName || '队友',
    avatarUrl: item.avatarUrl || '',
    content: item.content || '',
    payload: item.payload || {},
    createdAt: item.createdAt || Date.now(),
  };
}

function buildTeamRouteStats(room = {}) {
  const startedAt = room.startedAt || null;
  const endedAt = room.endedAt || null;
  const durationMs = startedAt && endedAt && endedAt >= startedAt ? endedAt - startedAt : 0;
  return {
    durationMs,
    pointCount: 0,
    distanceMeters: 0,
    durationLabel: formatDuration(durationMs),
    distanceLabel: formatDistance(0),
    startedLabel: formatTrackTime(startedAt),
    stoppedLabel: endedAt ? formatTrackTime(endedAt) : (room.status === 'active' ? '进行中' : '未记录'),
  };
}

function normalizeTeamWalkRecord(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const themeSnapshot = item.themeSnapshot || {};
  const members = Array.isArray(item.members)
    ? item.members.map(normalizeTeamMember).filter(Boolean)
    : [];
  const contributions = Array.isArray(item.contributions)
    ? item.contributions.map(normalizeTeamContribution).filter(Boolean)
    : [];
  const activities = Array.isArray(item.activities)
    ? item.activities.map(normalizeTeamActivity).filter(Boolean)
    : [];
  const missionCardMap = item.missionCardMap || {};
  const teamStats = item.teamStats || {};
  const generationContext = item.generationContext || {};

  return {
    _id: item._id || item.id || '',
    id: item._id || item.id || '',
    recordType: 'team',
    ownerUserId: item.ownerUserId || '',
    themeTitle: item.themeTitle || themeSnapshot.title || '同行漫步',
    themeCategory: item.themeCategory || themeSnapshot.category || '',
    locationName: item.locationName || '未知地点',
    locationContext: item.locationContext || '',
    locationAddress: item.locationAddress || '',
    noteText: item.teamSummary || item.summary || '',
    createdAt: item.createdAt || Date.now(),
    status: item.status || 'waiting',
    walkMode: item.walkMode || 'pure',
    coverImage: item.coverImage || '',
    startedAt: item.startedAt || null,
    endedAt: item.endedAt || null,
    routeStats: buildTeamRouteStats(item),
    teamStats: {
      memberCount: teamStats.memberCount || item.memberCount || members.length,
      contributionCount: teamStats.contributionCount || contributions.length,
      completedMissionCount: teamStats.completedMissionCount || 0,
      totalMissionCount: teamStats.totalMissionCount || ((themeSnapshot.missions || []).length),
      photoCount: teamStats.photoCount || 0,
      videoCount: teamStats.videoCount || 0,
      audioCount: teamStats.audioCount || 0,
    },
    themeSnapshot: {
      ...themeSnapshot,
      title: item.themeTitle || themeSnapshot.title || '同行漫步',
      category: item.themeCategory || themeSnapshot.category || '',
      missions: Array.isArray(themeSnapshot.missions) ? themeSnapshot.missions : [],
    },
    members,
    contributions,
    activities,
    missionCardMap,
    canDelete: false,
    isPublic: false,
    memberRole: item.memberRole || '',
    season: item.season || generationContext.season || '',
    generationContext,
  };
}

const ENDPOINTS = {
  syncUser: {
    cloudName: 'syncUser',
    web: {
      path: '/miniapp/auth/sync-user',
      method: 'POST',
      normalizeRequest: (data) => ({
        code: data.code,
        nickName: data.nickName,
        avatarUrl: data.avatarUrl,
      }),
      normalizeResponse: (data) => {
        persistAuthSession(data);
        return data;
      },
    },
  },
  generateTheme: {
    cloudName: 'generateTheme',
    web: {
      path: '/ai/themes/generate',
      method: 'POST',
      normalizeResponse: (data, requestData) => normalizeThemeResponse(data, requestData, data && data.provider ? 'rag+ai' : 'rag-fallback'),
    },
  },
  generateCombinedTheme: {
    cloudName: 'generateCombinedTheme',
    web: {
      path: '/ai/themes/combine',
      method: 'POST',
      normalizeResponse: (data, requestData) => normalizeThemeResponse(data, requestData, data && data.provider ? 'combined+ai' : 'combined-fallback'),
    },
  },
  getLocationContext: {
    cloudName: 'getLocationContext',
    web: {
      path: '/ai/location/context',
      method: 'GET',
      normalizeRequest: (data) => ({
        lat: data.latitude,
        lng: data.longitude,
      }),
      normalizeResponse: (data, requestData) => ({
        placeName: requestData.placeName || '当前位置',
        context: (data && data.locationContext) || requestData.placeName || '城市街道',
      }),
    },
  },
  searchLocations: {
    cloudName: '',
    web: {
      path: '/map/search',
      method: 'GET',
      normalizeRequest: (data) => ({
        query: data.query,
      }),
      normalizeResponse: (data) => (Array.isArray(data) ? data : []),
    },
  },
  fetchNearbyPois: {
    cloudName: '',
    web: {
      path: '/map/pois/nearby',
      method: 'GET',
      normalizeRequest: (data) => ({
        lat: data.lat,
        lng: data.lng,
      }),
      normalizeResponse: (data) => (Array.isArray(data) ? data : []),
    },
  },
  verifyMission: {
    cloudName: 'verifyMission',
    web: {
      path: '/ai/missions/verify',
      method: 'POST',
      normalizeRequest: (data) => {
        const fileIDs = Array.isArray(data.fileIDs) ? data.fileIDs.filter(Boolean) : [];
        return {
          mission: data.mission,
          noteText: data.noteText,
          fileIDs,
          fileUrls: fileIDs.filter((item) => String(item).startsWith('http')),
        };
      },
    },
  },
  generateSticker: {
    cloudName: 'generateSticker',
  },
  generateStickerPlan: {
    cloudName: 'generateSticker',
  },
  generateStickerImage: {
    cloudName: 'generateSticker',
  },
  generateCompanionNote: {
    cloudName: 'generateSticker',
  },
  createWalk: {
    cloudName: 'createWalk',
    normalizeCloudResponse: (data) => ({
      ok: !!(data && data.ok),
      id: data && data.id ? data.id : '',
      walk: data && data.walk ? normalizeWalkRecord(data.walk) : null,
    }),
    web: {
      path: '/walks',
      method: 'POST',
      normalizeRequest: (data) => {
        const photoUrl = Array.isArray(data.photoList) && data.photoList.length ? data.photoList[0] : '';
        const videoUrl = Array.isArray(data.videoList) && data.videoList.length ? data.videoList[0] : '';
        const audioUrl = Array.isArray(data.audioList) && data.audioList.length ? data.audioList[0] : '';
        const primaryMediaUrl = photoUrl || videoUrl || audioUrl || '';
        const primaryMediaType = photoUrl ? 'image' : videoUrl ? 'video' : audioUrl ? 'audio' : '';
        const completed = Array.isArray(data.missionsCompleted) ? data.missionsCompleted : [];
        const reviews = data.missionReviews || {};
        const missionAssetMap = data.missionAssetMap || {};
        return {
          themeTitle: data.themeTitle || (data.themeSnapshot && data.themeSnapshot.title) || '',
          themeCategory: (data.themeSnapshot && data.themeSnapshot.category) || '',
          locationName: data.locationName || '',
          locationAddress: data.locationAddress || '',
          recordUnit: photoUrl ? 'image' : Array.isArray(data.routePoints) && data.routePoints.length ? 'location' : 'event',
          isPublic: !!data.isPublic,
          noteText: data.noteText || '',
          path: (data.routePoints || []).map((point) => ({
            lat: point.lat !== undefined ? point.lat : point.latitude,
            lng: point.lng !== undefined ? point.lng : point.longitude,
            timestamp: point.timestamp || Date.now(),
          })),
          completedMissions: completed.map((mission) => {
            const review = reviews[mission] || {};
            const reviewMediaUrl = Array.isArray(review.photoList) && review.photoList.length ? review.photoList[0] : primaryMediaUrl;
            const reviewMediaType = Array.isArray(review.photoList) && review.photoList.length ? 'image' : primaryMediaType;
            return {
              mission,
              mediaUrl: reviewMediaUrl || '',
              mediaType: reviewMediaType || '',
            };
          }),
          themeSnapshot: data.themeSnapshot || null,
          missionReviews: reviews,
          missionAssetMap,
          walkMode: data.walkMode || 'pure',
          generationSource: data.generationSource || 'unknown',
          season: data.season || '',
          generationContext: data.generationContext || {},
          trackStartedAt: data.trackStartedAt || null,
          trackStoppedAt: data.trackStoppedAt || null,
          routeStats: data.routeStats || null,
          sticker: data.sticker || null,
          photoUrl,
          videoUrl,
          audioUrl,
        };
      },
      normalizeResponse: (data) => ({
        walk: normalizeWalkRecord(data),
      }),
    },
  },
  listMyWalks: {
    cloudName: 'listMyWalks',
    normalizeCloudResponse: (data) => ({
      records: Array.isArray(data.records) ? data.records.map(normalizeWalkRecord).filter(Boolean) : [],
    }),
    web: {
      path: '/walks/me',
      method: 'GET',
      normalizeRequest: (data) => ({
        page: 1,
        pageSize: data.limit || data.pageSize || 20,
      }),
      normalizeResponse: (data) => ({
        records: Array.isArray(data) ? data.map(normalizeWalkRecord).filter(Boolean) : [],
      }),
    },
  },
  listMyAchievements: {
    cloudName: 'listMyAchievements',
    normalizeCloudResponse: (data) => ({
      achievements: Array.isArray(data && data.achievements) ? data.achievements : [],
      summary: data && data.summary ? data.summary : {
        unlockedCount: 0,
        totalCount: 0,
        completionRate: 0,
      },
      updatedAt: data && data.updatedAt ? data.updatedAt : 0,
    }),
  },
  listPublicWalks: {
    cloudName: 'listPublicWalks',
    normalizeCloudResponse: (data) => ({
      records: Array.isArray(data.records) ? data.records.map(normalizeWalkRecord).filter(Boolean) : [],
    }),
    web: {
      path: '/walks/public',
      method: 'GET',
      normalizeRequest: (data) => ({
        page: 1,
        pageSize: data.limit || data.pageSize || 20,
      }),
      normalizeResponse: (data) => ({
        records: Array.isArray(data) ? data.map(normalizeWalkRecord).filter(Boolean) : [],
      }),
    },
  },
  getWalkDetail: {
    cloudName: 'getWalkDetail',
    normalizeCloudResponse: (data) => ({
      walk: data && data.walk ? normalizeWalkRecord(data.walk) : null,
    }),
    web: {
      path: '/walks',
      method: 'GET',
      resolvePath: (data) => `/walks/${encodeURIComponent(data.id)}`,
      normalizeRequest: () => ({}),
      normalizeResponse: (data) => ({
        walk: normalizeWalkRecord(data),
      }),
    },
  },
  publishWalkShare: {
    cloudName: 'publishWalkShare',
    normalizeCloudResponse: (data) => ({
      ok: !!(data && data.ok),
      walk: data && data.walk ? normalizeWalkRecord(data.walk) : null,
    }),
  },
  deleteWalk: {
    cloudName: 'deleteWalk',
    normalizeCloudResponse: (data) => ({
      ok: !!(data && data.ok),
      id: data && data.id ? data.id : '',
      reason: data && data.reason ? data.reason : '',
    }),
    web: {
      path: '/walks',
      method: 'DELETE',
      resolvePath: (data) => `/walks/${encodeURIComponent(data.id)}`,
      normalizeRequest: () => ({}),
      normalizeResponse: (data, requestData) => ({
        ok: !!(data && (data.ok !== undefined ? data.ok : true)),
        id: (data && data.id) || requestData.id || '',
        reason: (data && data.reason) || '',
      }),
    },
  },
  deleteTeamWalk: {
    cloudName: 'deleteTeamWalk',
    normalizeCloudResponse: (data) => ({
      ok: !!(data && data.ok),
      id: data && data.id ? data.id : '',
      reason: data && data.reason ? data.reason : '',
    }),
  },
  createTeamRoom: {
    cloudName: 'createTeamRoom',
    normalizeCloudResponse: (data) => ({
      roomId: data && data.roomId ? data.roomId : '',
      room: data && data.room ? normalizeTeamWalkRecord(data.room) : null,
    }),
  },
  getTeamRoomDetail: {
    cloudName: 'getTeamRoomDetail',
    normalizeCloudResponse: (data) => ({
      room: data && data.room ? normalizeTeamWalkRecord(data.room) : null,
    }),
  },
  joinTeamRoom: {
    cloudName: 'joinTeamRoom',
    normalizeCloudResponse: (data) => ({
      joined: !!(data && data.joined),
      room: data && data.room ? normalizeTeamWalkRecord(data.room) : null,
    }),
  },
  leaveTeamRoom: {
    cloudName: 'leaveTeamRoom',
    normalizeCloudResponse: (data) => ({
      ok: !!(data && data.ok),
      room: data && data.room ? normalizeTeamWalkRecord(data.room) : null,
      reason: data && data.reason ? data.reason : '',
    }),
  },
  startTeamWalk: {
    cloudName: 'startTeamWalk',
    normalizeCloudResponse: (data) => ({
      ok: !!(data && data.ok),
      room: data && data.room ? normalizeTeamWalkRecord(data.room) : null,
    }),
  },
  submitTeamContribution: {
    cloudName: 'submitTeamContribution',
    normalizeCloudResponse: (data) => ({
      ok: !!(data && data.ok),
      contribution: data && data.contribution ? normalizeTeamContribution(data.contribution) : null,
      room: data && data.room ? normalizeTeamWalkRecord(data.room) : null,
    }),
  },
  submitContentFeedback: {
    cloudName: 'submitContentFeedback',
    normalizeCloudResponse: (data) => ({
      ok: !!(data && data.ok),
      id: data && data.id ? data.id : '',
      reason: data && data.reason ? data.reason : '',
    }),
  },
  listTeamActivities: {
    cloudName: 'listTeamActivities',
    normalizeCloudResponse: (data) => ({
      activities: Array.isArray(data && data.activities) ? data.activities.map(normalizeTeamActivity).filter(Boolean) : [],
    }),
  },
  finishTeamWalk: {
    cloudName: 'finishTeamWalk',
    normalizeCloudResponse: (data) => ({
      ok: !!(data && data.ok),
      room: data && data.room ? normalizeTeamWalkRecord(data.room) : null,
    }),
  },
  getTeamWalkDetail: {
    cloudName: 'getTeamWalkDetail',
    normalizeCloudResponse: (data) => ({
      room: data && data.room ? normalizeTeamWalkRecord(data.room) : null,
    }),
  },
  saveTeamMissionCard: {
    cloudName: 'saveTeamMissionCard',
  },
  updateTeamMemberDraftState: {
    cloudName: 'updateTeamMemberDraftState',
  },
  listMyTeamWalks: {
    cloudName: 'listMyTeamWalks',
    normalizeCloudResponse: (data) => ({
      records: Array.isArray(data && data.records) ? data.records.map(normalizeTeamWalkRecord).filter(Boolean) : [],
    }),
  },
  uploadMedia: {
    cloudName: '',
    web: {
      path: '/files/upload',
      method: 'UPLOAD',
      normalizeUploadFormData: (formData) => ({
        bizType:
          formData.kind === 'video'
            ? 'video'
            : formData.kind === 'audio'
              ? 'audio'
              : 'mission_media',
      }),
    },
  },
};

function getBackendProvider() {
  return apiBaseUrl ? 'web' : 'cloud';
}

function shouldUseCloudEndpoint(name) {
  if (!apiBaseUrl) {
    return true;
  }
  return CLOUD_ENDPOINTS.has(name);
}

function getStoredToken() {
  try {
    return wx.getStorageSync('citywalk_token') || '';
  } catch (error) {
    return '';
  }
}

function persistAuthSession(data) {
  if (!data || typeof data !== 'object') {
    return;
  }

  try {
    if (data.token) {
      wx.setStorageSync('citywalk_token', data.token);
    }
    if (data.refreshToken) {
      wx.setStorageSync('citywalk_refresh_token', data.refreshToken);
    }
    if (data.expiresIn !== undefined) {
      wx.setStorageSync('citywalk_token_expires_in', data.expiresIn);
    }
  } catch (error) {
    // Ignore storage failures so login can still proceed in-memory.
  }
}

function normalizeResponse(response) {
  if (response && typeof response === 'object') {
    if (Object.prototype.hasOwnProperty.call(response, 'data')) {
      return response.data;
    }
    return response;
  }
  return {};
}

function formatDistance(distanceMeters) {
  const meters = Number(distanceMeters || 0);
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${Math.round(meters)} m`;
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round((durationMs || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}小时${minutes}分`;
  }
  if (minutes > 0) {
    return `${minutes}分${seconds}秒`;
  }
  return `${seconds}秒`;
}

function formatTrackTime(timestamp) {
  if (!timestamp) {
    return '未记录';
  }
  const date = new Date(timestamp);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

function buildUrl(path) {
  const base = apiBaseUrl.replace(/\/$/, '');
  const prefix = apiPrefix.replace(/\/$/, '');
  return `${base}${prefix}${path}`;
}

function toQueryString(data = {}) {
  return Object.keys(data)
    .filter((key) => data[key] !== undefined && data[key] !== null && data[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
    .join('&');
}

function requestWeb({ path, method, data, header }) {
  const token = getStoredToken();
  const query = method === 'GET' ? toQueryString(data) : '';
  const finalUrl = query ? `${buildUrl(path)}?${query}` : buildUrl(path);
  return new Promise((resolve, reject) => {
    wx.request({
      url: finalUrl,
      method,
      data: method === 'GET' ? undefined : data,
      header: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...header,
      },
      timeout: requestTimeout,
      success(res) {
        const statusCode = res.statusCode || 500;
        if (statusCode >= 200 && statusCode < 300) {
          resolve(normalizeResponse(res.data));
          return;
        }
        reject(new Error((res.data && (res.data.message || res.data.error)) || `request_failed_${statusCode}`));
      },
      fail: reject,
    });
  });
}

function requestUpload(filePath, formData = {}, options = {}) {
  const endpoint = ENDPOINTS.uploadMedia;
  if (getBackendProvider() !== 'web' || !endpoint.web || useCloudMediaStorage) {
    const inferredExt = inferExtension(filePath, formData.kind === 'image' ? 'jpg' : '');
    const ext =
      formData.kind === 'video'
        ? (inferredExt || 'mp4')
        : formData.kind === 'audio'
          ? (inferredExt || 'mp3')
          : (inferredExt || 'jpg');
    return new Promise((resolve, reject) => {
      const uploadTask = uploadToCloud({
        cloudPath: `walks/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
        filePath,
      });
      if (uploadTask && uploadTask.onProgressUpdate && typeof options.onProgress === 'function') {
        uploadTask.onProgressUpdate((progressEvent) => {
          options.onProgress(progressEvent);
        });
      }
      Promise.resolve(uploadTask)
        .then((response) => resolve(response.fileID))
        .catch(reject);
    });
  }

  const token = getStoredToken();
  const normalizedFormData = endpoint.web.normalizeUploadFormData ? endpoint.web.normalizeUploadFormData(formData) : formData;
  return new Promise((resolve, reject) => {
    const uploadTask = wx.uploadFile({
      url: buildUrl(endpoint.web.path),
      filePath,
      name: 'file',
      formData: normalizedFormData,
      timeout: requestTimeout,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success(res) {
        let payload = {};
        try {
          payload = JSON.parse(res.data);
        } catch (error) {
          reject(new Error('upload_response_invalid'));
          return;
        }
        const normalized = normalizeResponse(payload);
        resolve(normalized.url || normalized.fileUrl || normalized.fileID || normalized.path);
      },
      fail: reject,
    });
    if (uploadTask && uploadTask.onProgressUpdate && typeof options.onProgress === 'function') {
      uploadTask.onProgressUpdate((progressEvent) => {
        options.onProgress(progressEvent);
      });
    }
  });
}

function callApi(name, data = {}) {
  const endpoint = ENDPOINTS[name];
  if (!endpoint) {
    return Promise.reject(new Error(`unknown_endpoint_${name}`));
  }

  if (shouldUseCloudEndpoint(name) || getBackendProvider() !== 'web') {
    return callCloud(endpoint.cloudName || name, data).then((response) => (
      endpoint.normalizeCloudResponse ? endpoint.normalizeCloudResponse(response, data) : response
    ));
  }

  if (!endpoint.web) {
    return Promise.reject(new Error(`web_endpoint_not_supported_${name}`));
  }

  const method = endpoint.web.method;
  const requestData = endpoint.web.normalizeRequest ? endpoint.web.normalizeRequest(data) : data;
  const path = endpoint.web.resolvePath ? endpoint.web.resolvePath(data) : endpoint.web.path;

  return requestWeb({ path, method, data: requestData }).then((response) => (
    endpoint.web.normalizeResponse ? endpoint.web.normalizeResponse(response, data) : response
  ));
}

module.exports = {
  callApi,
  getBackendProvider,
  requestUpload,
};

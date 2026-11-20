const TEAM_DRAFT_KEY = 'team_record_draft_store_v1';
const MAX_ROOM_DRAFTS = 20;

function createEmptyTeamDraftStore() {
  return {
    rooms: {},
  };
}

function cloneDraft(draft) {
  return {
    noteText: String((draft && draft.noteText) || ''),
    photoList: Array.isArray(draft && draft.photoList) ? [...draft.photoList] : [],
    videoList: Array.isArray(draft && draft.videoList) ? [...draft.videoList] : [],
    audioList: Array.isArray(draft && draft.audioList) ? [...draft.audioList] : [],
    companionNote: String((draft && draft.companionNote) || ''),
    completed: !!(draft && draft.completed),
  };
}

function buildRoomDraftKey(roomId, userId) {
  if (!roomId || !userId) {
    return '';
  }
  return `${roomId}:${userId}`;
}

function normalizeRoomDraft(roomDraft, roomId = '', userId = '') {
  const source = roomDraft && typeof roomDraft === 'object' ? roomDraft : {};
  const rawDrafts = source.drafts && typeof source.drafts === 'object' ? source.drafts : {};
  const drafts = {};

  Object.keys(rawDrafts).forEach((mission) => {
    if (!mission) {
      return;
    }
    const entry = rawDrafts[mission] && typeof rawDrafts[mission] === 'object' ? rawDrafts[mission] : {};
    drafts[mission] = {
      draft: cloneDraft(entry.draft || entry),
      dirty: !!entry.dirty,
      updatedAt: Number(entry.updatedAt || source.updatedAt || 0),
    };
  });

  return {
    roomId: source.roomId || roomId,
    userId: source.userId || userId,
    activeMission: source.activeMission || '',
    drafts,
    updatedAt: Number(source.updatedAt || 0),
  };
}

function normalizeTeamDraftStore(store) {
  const source = store && typeof store === 'object' ? store : {};
  const rawRooms = source.rooms && typeof source.rooms === 'object' ? source.rooms : {};
  const rooms = {};

  Object.keys(rawRooms).forEach((key) => {
    if (!key) {
      return;
    }
    rooms[key] = normalizeRoomDraft(rawRooms[key]);
  });

  return { rooms };
}

function loadTeamDraftStore() {
  try {
    return normalizeTeamDraftStore(wx.getStorageSync(TEAM_DRAFT_KEY));
  } catch (error) {
    console.warn('loadTeamDraftStore failed', error);
    return createEmptyTeamDraftStore();
  }
}

function saveTeamDraftStore(store) {
  const normalized = normalizeTeamDraftStore(store);
  const roomEntries = Object.entries(normalized.rooms)
    .sort((left, right) => Number((right[1] && right[1].updatedAt) || 0) - Number((left[1] && left[1].updatedAt) || 0))
    .slice(0, MAX_ROOM_DRAFTS);
  const compactStore = {
    rooms: roomEntries.reduce((result, entry) => {
      result[entry[0]] = entry[1];
      return result;
    }, {}),
  };

  try {
    wx.setStorageSync(TEAM_DRAFT_KEY, compactStore);
  } catch (error) {
    console.warn('saveTeamDraftStore failed', error);
  }
}

function loadTeamDraftRoom(roomId, userId) {
  const key = buildRoomDraftKey(roomId, userId);
  if (!key) {
    return normalizeRoomDraft(null, roomId, userId);
  }
  const store = loadTeamDraftStore();
  return normalizeRoomDraft(store.rooms[key], roomId, userId);
}

function saveTeamDraftRoom({ roomId, userId, activeMission = '', drafts = {}, dirtyMap = {} }) {
  const key = buildRoomDraftKey(roomId, userId);
  if (!key) {
    return;
  }

  const now = Date.now();
  const nextDrafts = {};
  Object.keys(drafts || {}).forEach((mission) => {
    if (!mission) {
      return;
    }
    nextDrafts[mission] = {
      draft: cloneDraft(drafts[mission]),
      dirty: !!dirtyMap[mission],
      updatedAt: now,
    };
  });

  const store = loadTeamDraftStore();
  store.rooms[key] = {
    roomId,
    userId,
    activeMission,
    drafts: nextDrafts,
    updatedAt: now,
  };
  saveTeamDraftStore(store);
}

function removeTeamDraftRoom(roomId, userId) {
  const key = buildRoomDraftKey(roomId, userId);
  if (!key) {
    return;
  }
  const store = loadTeamDraftStore();
  delete store.rooms[key];
  saveTeamDraftStore(store);
}

module.exports = {
  TEAM_DRAFT_KEY,
  loadTeamDraftRoom,
  removeTeamDraftRoom,
  saveTeamDraftRoom,
};

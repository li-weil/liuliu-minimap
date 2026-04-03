const DRAFT_KEY = 'walk_draft_store_v2';

function getDefaultDraft() {
  return {
    walkId: '',
    locationName: '当前位置',
    locationAddress: '',
    latitude: null,
    longitude: null,
    routePoints: [],
    completedMissions: [],
    missionReviews: {},
    missionAssetMap: {},
    selectedMission: '',
    noteText: '',
    photoList: [],
    videoList: [],
    audioList: [],
    isPublic: false,
    startedAt: null,
    endedAt: null,
    trackStartedAt: null,
    trackStoppedAt: null,
    routeStats: {
      durationMs: 0,
      pointCount: 0,
      distanceMeters: 0,
    },
    sticker: null,
    walkMode: 'pure',
    generationSource: 'preset',
    status: 'active',
  };
}

function getDefaultDraftStore() {
  return {
    activeWalkId: '',
    drafts: {},
  };
}

function normalizeDraftStore(store) {
  const source = store && typeof store === 'object' ? store : {};
  const rawDrafts = source.drafts && typeof source.drafts === 'object' ? source.drafts : {};
  const drafts = {};
  Object.keys(rawDrafts).forEach((walkId) => {
    if (!walkId) {
      return;
    }
    const draft = rawDrafts[walkId];
    drafts[walkId] = {
      ...getDefaultDraft(),
      ...(draft && typeof draft === 'object' ? draft : {}),
      walkId,
    };
  });
  return {
    activeWalkId: source.activeWalkId && drafts[source.activeWalkId] ? source.activeWalkId : '',
    drafts,
  };
}

function loadDraftStore(forceReset = false) {
  if (forceReset) {
    return getDefaultDraftStore();
  }

  try {
    const store = wx.getStorageSync(DRAFT_KEY);
    return normalizeDraftStore(store);
  } catch (error) {
    console.warn('loadDraftStore failed', error);
    return getDefaultDraftStore();
  }
}

function saveDraftStore(store) {
  try {
    wx.setStorageSync(DRAFT_KEY, normalizeDraftStore(store));
  } catch (error) {
    console.warn('saveDraftStore failed', error);
  }
}

function loadDraft(forceReset = false, walkId = '') {
  const store = loadDraftStore(forceReset);
  const targetWalkId = walkId || store.activeWalkId;
  if (!targetWalkId || !store.drafts[targetWalkId]) {
    return getDefaultDraft();
  }
  return {
    ...getDefaultDraft(),
    ...store.drafts[targetWalkId],
    walkId: targetWalkId,
  };
}

function saveDraft(draft, walkId = '') {
  const store = loadDraftStore();
  const nextWalkId = walkId || (draft && draft.walkId) || '';
  if (!nextWalkId) {
    return;
  }
  store.activeWalkId = nextWalkId;
  store.drafts[nextWalkId] = {
    ...getDefaultDraft(),
    ...(draft && typeof draft === 'object' ? draft : {}),
    walkId: nextWalkId,
  };
  saveDraftStore(store);
}

function removeDraft(walkId) {
  if (!walkId) {
    return;
  }
  const store = loadDraftStore();
  delete store.drafts[walkId];
  if (store.activeWalkId === walkId) {
    store.activeWalkId = '';
  }
  saveDraftStore(store);
}

module.exports = {
  DRAFT_KEY,
  getDefaultDraft,
  getDefaultDraftStore,
  loadDraft,
  loadDraftStore,
  removeDraft,
  saveDraft,
  saveDraftStore,
};

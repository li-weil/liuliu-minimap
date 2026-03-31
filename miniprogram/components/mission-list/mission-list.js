Component({
  data: {
    missionCards: [],
  },

  properties: {
    activeMission: {
      type: String,
      value: '',
    },
    expandedMission: {
      type: String,
      value: '',
    },
    missions: {
      type: Array,
      value: [],
    },
    completedMissions: {
      type: Array,
      value: [],
    },
    missionReviews: {
      type: Object,
      value: {},
    },
    missionAssetMap: {
      type: Object,
      value: {},
    },
  },

  observers: {
    'missions, activeMission, expandedMission, completedMissions, missionReviews, missionAssetMap': function updateMissionCards(missions, activeMission, expandedMission, completedMissions, missionReviews, missionAssetMap) {
      const completedSet = new Set(completedMissions || []);
      const cards = (missions || []).map((mission) => ({
        mission,
        active: activeMission === mission,
        expanded: expandedMission === mission,
        completed: completedSet.has(mission),
        review: missionReviews && missionReviews[mission] ? missionReviews[mission] : null,
        assets: missionAssetMap && missionAssetMap[mission] ? missionAssetMap[mission] : null,
      }));
      this.setData({ missionCards: cards });
    },
  },

  methods: {
    selectMission(event) {
      const mission = event.currentTarget.dataset.mission;
      this.triggerEvent('select', { mission });
    },

    toggleMission(event) {
      const mission = event.currentTarget.dataset.mission;
      this.triggerEvent('toggle', { mission });
    },

    verifyMission(event) {
      const mission = event.currentTarget.dataset.mission;
      const mode = event.currentTarget.dataset.mode || '';
      this.triggerEvent('verify', { mission, mode });
    },

    inputMissionNote(event) {
      const mission = event.currentTarget.dataset.mission;
      const noteText = event.detail.value;
      this.triggerEvent('missionnote', { mission, noteText });
    },
  },
});

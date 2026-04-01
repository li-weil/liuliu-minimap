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
    locationName: {
      type: String,
      value: '',
    },
    themeTitle: {
      type: String,
      value: '',
    },
    dateLabel: {
      type: String,
      value: '',
    },
    accentColor: {
      type: String,
      value: '#c96f4a',
    },
    generatedMissionCardMap: {
      type: Object,
      value: {},
    },
    supplementalMissionKey: {
      type: String,
      value: '',
    },
    supplementalMissionLabel: {
      type: String,
      value: '',
    },
    isRecordingAudio: {
      type: Boolean,
      value: false,
    },
    recordingMission: {
      type: String,
      value: '',
    },
  },

  observers: {
    'missions, activeMission, expandedMission, completedMissions, missionReviews, missionAssetMap, generatedMissionCardMap, supplementalMissionKey, supplementalMissionLabel': function updateMissionCards(
      missions,
      activeMission,
      expandedMission,
      completedMissions,
      missionReviews,
      missionAssetMap,
      generatedMissionCardMap,
      supplementalMissionKey,
      supplementalMissionLabel
    ) {
      const completedSet = new Set(completedMissions || []);
      const missionItems = [...(missions || [])];
      if (supplementalMissionKey && supplementalMissionLabel) {
        missionItems.push({
          key: supplementalMissionKey,
          label: supplementalMissionLabel,
          isSupplemental: true,
        });
      }
      const cards = missionItems.map((missionItem) => {
        const isObjectMission = missionItem && typeof missionItem === 'object';
        const mission = isObjectMission ? missionItem.key : missionItem;
        const label = isObjectMission ? missionItem.label : missionItem;
        const isSupplemental = !!(isObjectMission && missionItem.isSupplemental);
        return {
          mission,
          label,
          isSupplemental,
          active: activeMission === mission,
          expanded: expandedMission === mission,
          completed: isSupplemental ? false : completedSet.has(mission),
          review: missionReviews && missionReviews[mission] ? missionReviews[mission] : null,
          assets: missionAssetMap && missionAssetMap[mission] ? missionAssetMap[mission] : null,
          cardVersion: generatedMissionCardMap && generatedMissionCardMap[mission] ? generatedMissionCardMap[mission] : 0,
        };
      });
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

    generateCard(event) {
      const mission = event.currentTarget.dataset.mission;
      this.triggerEvent('generatecard', { mission });
    },

    inputMissionNote(event) {
      const mission = event.currentTarget.dataset.mission;
      const noteText = event.detail.value;
      this.triggerEvent('missionnote', { mission, noteText });
    },

    removePhoto(event) {
      const mission = event.currentTarget.dataset.mission;
      const index = Number(event.currentTarget.dataset.index);
      this.triggerEvent('removephoto', { mission, index });
    },

    removeVideo(event) {
      const mission = event.currentTarget.dataset.mission;
      const index = Number(event.currentTarget.dataset.index);
      this.triggerEvent('removevideo', { mission, index });
    },

    removeAudio(event) {
      const mission = event.currentTarget.dataset.mission;
      const index = Number(event.currentTarget.dataset.index);
      this.triggerEvent('removeaudio', { mission, index });
    },
  },
});

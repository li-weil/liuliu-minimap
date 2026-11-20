const { formatDate } = require('../../utils/format');

Component({
  properties: {
    walk: {
      type: Object,
      value: null,
    },
  },

  methods: {
    openDetail() {
      this.triggerEvent('open', {
        id: this.properties.walk && (this.properties.walk.id || this.properties.walk._id),
        recordType: this.properties.walk && this.properties.walk.recordType ? this.properties.walk.recordType : 'solo',
      });
    },

    formatTime(value) {
      return formatDate(value);
    },
  },
});

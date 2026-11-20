const { submitContentFeedback } = require('../../services/team');

const CATEGORY_OPTIONS = [
  { key: '不当文本', label: '不当文本' },
  { key: '不当图片', label: '不当图片' },
  { key: '骚扰冒犯', label: '骚扰冒犯' },
  { key: '其他问题', label: '其他问题' },
];

function decodeQueryValue(value, fallback = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallback;
  }
  try {
    return decodeURIComponent(normalized);
  } catch (error) {
    return normalized;
  }
}

function explainSubmitFailure(error) {
  const rawMessage = String((error && error.errMsg) || (error && error.message) || '').trim();
  const message = rawMessage.toLowerCase();
  if (!message) {
    return '提交失败，请稍后再试';
  }
  if (message.includes('function not found') || message.includes('cloud function')) {
    return '反馈云函数还没部署';
  }
  if (message.includes('missing_openid')) {
    return '登录状态异常，请重新进入';
  }
  if (message.includes('missing_category')) {
    return '请先选择问题类型';
  }
  if (message.includes('missing_message')) {
    return '请补充问题描述';
  }
  if (message.includes('network')) {
    return '网络异常，请稍后再试';
  }
  return `提交失败：${rawMessage}`;
}

function buildFeedbackShareTitle() {
  const app = getApp();
  const user = app.globalData.user || null;
  if (user && user.nickName) {
    return `遛遛 | ${user.nickName} 邀你一起 citywalk`;
  }

  return '遛遛 | 邀你一起 citywalk';
}

Page({
  data: {
    submitting: false,
    sourceType: 'team',
    scene: 'team-room',
    roomId: '',
    contributionId: '',
    missionKey: '',
    targetUserId: '',
    targetNickName: '',
    sceneLabel: '同行协作',
    categoryOptions: CATEGORY_OPTIONS,
    activeCategory: CATEGORY_OPTIONS[0].key,
    message: '',
  },

  onLoad(query) {
    this.setData({
      sourceType: query.sourceType || 'team',
      scene: query.scene || 'team-room',
      roomId: query.roomId || '',
      contributionId: query.contributionId || '',
      missionKey: query.missionKey || '',
      targetUserId: query.targetUserId || '',
      targetNickName: decodeQueryValue(query.targetNickName || ''),
      sceneLabel: decodeQueryValue(query.sceneLabel || '', '同行协作'),
    });
  },

  onShareAppMessage() {
    return {
      title: buildFeedbackShareTitle(),
      path: '/pages/index/index',
    };
  },

  handleCategoryTap(event) {
    const category = event.currentTarget.dataset.category;
    if (!category) {
      return;
    }
    this.setData({ activeCategory: category });
  },

  handleMessageInput(event) {
    this.setData({ message: event.detail.value || '' });
  },

  async handleSubmit() {
    const message = String(this.data.message || '').trim();
    if (!this.data.activeCategory) {
      wx.showToast({ title: '请选择问题类型', icon: 'none' });
      return;
    }
    if (!message) {
      wx.showToast({ title: '请补充问题描述', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const result = await submitContentFeedback({
        sourceType: this.data.sourceType,
        scene: this.data.scene,
        roomId: this.data.roomId,
        contributionId: this.data.contributionId,
        missionKey: this.data.missionKey,
        targetUserId: this.data.targetUserId,
        targetNickName: this.data.targetNickName,
        category: this.data.activeCategory,
        message,
      });
      if (!result || !result.ok) {
        throw new Error((result && result.reason) || 'submit_failed');
      }
      wx.showToast({ title: '已提交反馈', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack({
          fail: () => {
            wx.switchTab({ url: '/pages/profile/profile' });
          },
        });
      }, 300);
    } catch (error) {
      const errorText = explainSubmitFailure(error);
      console.error('submitContentFeedback failed:', error);
      wx.showModal({
        title: '提交失败',
        content: errorText,
        showCancel: false,
        confirmText: '知道了',
      });
    } finally {
      this.setData({ submitting: false });
    }
  },
});

// 开屏四道选择题：给游客贴标签（可跳过，首启展示一次）
const userTags = require('../../utils/userTags');
const { callApi } = require('../../services/api');

Page({
  data: {
    step: 0,
    stepCount: userTags.QUESTIONS.length,
    question: null,
    selected: -1,
    answers: {},
    skippedCount: 0,
    finishing: false,
  },

  onLoad() {
    this.setData({ question: userTags.QUESTIONS[0], selected: -1 });
  },

  onSelect(event) {
    const index = Number(event.currentTarget.dataset.index);
    const { step, answers } = this.data;
    const question = userTags.QUESTIONS[step];
    const nextAnswers = Object.assign({}, answers);
    nextAnswers[question.key] = index;
    this.setData({ selected: index, answers: nextAnswers });
    // 选择后短暂停顿进入下一题，最后一题完成
    setTimeout(() => this.advance(), 260);
  },

  onSkip() {
    const { answers } = this.data;
    this.setData({ answers, skippedCount: this.data.skippedCount + 1, selected: -1 });
    this.advance();
  },

  advance() {
    const nextStep = this.data.step + 1;
    if (nextStep >= userTags.QUESTIONS.length) {
      this.finish();
      return;
    }
    this.setData({ step: nextStep, question: userTags.QUESTIONS[nextStep], selected: -1 });
  },

  finish() {
    if (this.data.finishing) return;
    this.setData({ finishing: true });
    const { answers } = this.data;
    const tags = userTags.computeTags(answers);
    const profile = { tags, answers, updatedAt: Date.now() };

    userTags.markOnboardingDone(profile);
    if (typeof this.getOpenerEventChannel === 'function') {
      const channel = this.getOpenerEventChannel();
      if (channel && channel.emit) channel.emit('onboardingDone', profile);
    }

    // 云端留存（失败不阻塞进入小程序）
    callApi('saveUserTags', { tags, answers }).catch(() => {});

    wx.reLaunch({ url: '/pages/dongao/dongao' });
  },
});

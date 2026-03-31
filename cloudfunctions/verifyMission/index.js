const cloud = require('wx-server-sdk');
const {
  analyzeAudioMission,
  analyzeVisualMission,
  summarizeMissionReview,
} = require('./ai');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

async function getTempFileUrls(fileIDs) {
  if (!fileIDs || !fileIDs.length) {
    return [];
  }

  const result = await cloud.getTempFileURL({ fileList: fileIDs });
  return (result.fileList || [])
    .map((item) => item.tempFileURL)
    .filter(Boolean);
}

function buildFallbackReview({ imageCount, videoCount, audioCount, missionNoteText }) {
  const mediaCount = imageCount + videoCount + audioCount;
  const noteBonus = missionNoteText && missionNoteText.trim() ? 12 : 0;
  const score = Math.min(95, 32 + imageCount * 16 + videoCount * 20 + audioCount * 18 + noteBonus);
  return {
    passed: score >= 60,
    score,
    confidence: 'fallback',
    evidence: [
      imageCount ? `补充了 ${imageCount} 张图片` : '',
      videoCount ? `补充了 ${videoCount} 段视频` : '',
      audioCount ? `补充了 ${audioCount} 段录音` : '',
      missionNoteText && missionNoteText.trim() ? '写下了任务说明文字' : '',
    ].filter(Boolean),
    comment: score >= 60
      ? '已经收到了与你任务相关的素材，这次打卡先为你点亮'
      : '已经收到一些记录，再补一张更贴题的图像或一句更具体的描述会更稳',
  };
}

exports.main = async (event) => {
  const missionId = event.missionId || '';
  const mission = event.mission || '';
  const missionNoteText = event.missionNoteText || '';
  const overallNoteText = event.overallNoteText || '';
  const imageFileIDs = Array.isArray(event.imageFileIDs) ? event.imageFileIDs.filter(Boolean) : [];
  const videoFileIDs = Array.isArray(event.videoFileIDs) ? event.videoFileIDs.filter(Boolean) : [];
  const audioFileIDs = Array.isArray(event.audioFileIDs) ? event.audioFileIDs.filter(Boolean) : [];

  if (!mission) {
    return {
      passed: false,
      score: 0,
      comment: '还没有找到对应任务，先选一个任务再来核验',
      confidence: 'low',
      reviewedAt: Date.now(),
      reason: 'missing_mission',
    };
  }

  if (!imageFileIDs.length && !videoFileIDs.length && !audioFileIDs.length && !missionNoteText.trim()) {
    return {
      passed: false,
      score: 0,
      comment: '先为这个任务补一张图、一段视频、录音，或者写一句说明，再让 AI 来打分',
      confidence: 'low',
      reviewedAt: Date.now(),
      reason: 'missing_input',
    };
  }

  const mediaSummary = {
    imageCount: imageFileIDs.length,
    videoCount: videoFileIDs.length,
    audioCount: audioFileIDs.length,
  };

  try {
    const [imageUrls, videoUrls, audioUrls] = await Promise.all([
      getTempFileUrls(imageFileIDs),
      getTempFileUrls(videoFileIDs),
      getTempFileUrls(audioFileIDs),
    ]);

    const [visualResult, audioResult] = await Promise.all([
      analyzeVisualMission({
        mission,
        missionNoteText,
        overallNoteText,
        imageUrls,
        videoUrls,
      }),
      analyzeAudioMission({
        mission,
        missionNoteText,
        overallNoteText,
        audioUrls,
      }),
    ]);

    const summary = await summarizeMissionReview({
      mission,
      missionNoteText,
      overallNoteText,
      visualResult,
      audioResult,
      mediaSummary,
    });

    const score = Math.max(0, Math.min(100, Number(summary.score || 0)));
    return {
      missionId,
      version: 'verifyMission-v2',
      passed: summary.passed !== undefined ? !!summary.passed : score >= 60,
      score,
      confidence: summary.confidence || visualResult.confidence || audioResult.confidence || 'medium',
      evidence: Array.isArray(summary.evidence) ? summary.evidence : [],
      comment: summary.comment || (score >= 60 ? '这次记录已经足够说明你完成了任务' : '这次素材已经接近任务要求，再补一条更贴题的记录会更稳'),
      mediaSummary,
      reviewedAt: Date.now(),
    };
  } catch (error) {
    const fallback = buildFallbackReview({
      imageCount: mediaSummary.imageCount,
      videoCount: mediaSummary.videoCount,
      audioCount: mediaSummary.audioCount,
      missionNoteText,
    });
    return {
      missionId,
      version: 'verifyMission-v2',
      ...fallback,
      reviewedAt: Date.now(),
      reason: error.message || 'verify_failed',
      mediaSummary,
    };
  }
};

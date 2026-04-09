const { ensureCanvasCompatibleImage } = require('../../utils/media');

const CARD_WIDTH = 327;
const SIDE_PADDING = 22;
const HEADER_HEIGHT = 148;
const CONTENT_WIDTH = CARD_WIDTH - SIDE_PADDING * 2;
const DIALOG_WIDTH = 222;
const BUBBLE_PADDING_X = 16;
const BUBBLE_PADDING_Y = 14;
const DIALOG_LINE_HEIGHT = 22;
const PHOTO_GAP = 12;

function drawPerforationEdge(ctx, x, y, width, height, radius = 3.2, gap = 6.4) {
  const countX = Math.max(2, Math.floor(width / gap));
  const countY = Math.max(2, Math.floor(height / gap));
  for (let index = 0; index <= countX; index += 1) {
    const cx = x + (index * width) / countX;
    ctx.beginPath();
    ctx.arc(cx, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, y + height, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let index = 1; index < countY; index += 1) {
    const cy = y + (index * height) / countY;
    ctx.beginPath();
    ctx.arc(x, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + width, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function fillTextWithSpacing(ctx, text, x, y, spacing = 1.4) {
  const value = String(text || '');
  let cursor = x;
  [...value].forEach((char) => {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + spacing;
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function splitTextToLines(ctx, text, maxWidth) {
  const value = String(text || '').trim();
  if (!value) {
    return [];
  }
  const rawParagraphs = value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const lines = [];
  rawParagraphs.forEach((paragraph) => {
    let current = '';
    [...paragraph].forEach((char) => {
      const next = `${current}${char}`;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = char;
        return;
      }
      current = next;
    });
    if (current) {
      lines.push(current);
    }
  });
  return lines;
}

function buildFont(size, family = 'sans-serif', weight = '') {
  return `${weight ? `${weight} ` : ''}${size}px ${family}`;
}

function layoutParagraph(ctx, text, options = {}) {
  const {
    maxWidth = 180,
    preferredSize = 14,
    minSize = 11,
    maxLines = 8,
    family = 'sans-serif',
    weight = '',
    lineHeightRatio = 1.62,
  } = options;

  for (let size = preferredSize; size >= minSize; size -= 1) {
    ctx.font = buildFont(size, family, weight);
    const lines = splitTextToLines(ctx, text, maxWidth);
    if (lines.length <= maxLines) {
      return {
        font: buildFont(size, family, weight),
        fontSize: size,
        lineHeight: Math.round(size * lineHeightRatio),
        lines,
      };
    }
  }

  ctx.font = buildFont(minSize, family, weight);
  const lines = splitTextToLines(ctx, text, maxWidth).slice(0, maxLines);
  return {
    font: buildFont(minSize, family, weight),
    fontSize: minSize,
    lineHeight: Math.round(minSize * lineHeightRatio),
    lines,
  };
}

function formatCardDate(rawValue) {
  if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
    const year = rawValue.getFullYear();
    const month = `${rawValue.getMonth() + 1}`.padStart(2, '0');
    const day = `${rawValue.getDate()}`.padStart(2, '0');
    return `${year}.${month}.${day}`;
  }
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    const date = new Date(rawValue);
    if (!Number.isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = `${date.getMonth() + 1}`.padStart(2, '0');
      const day = `${date.getDate()}`.padStart(2, '0');
      return `${year}.${month}.${day}`;
    }
  }
  if (rawValue) {
    const normalized = String(rawValue).trim().replace(/\//g, '.').replace(/-/g, '.');
    const fullDateMatch = normalized.match(/(\d{4})\.(\d{2})\.(\d{2})/);
    if (fullDateMatch) {
      return `${fullDateMatch[1]}.${fullDateMatch[2]}.${fullDateMatch[3]}`;
    }
    const monthDayMatch = normalized.match(/(\d{2})\.(\d{2})/);
    if (monthDayMatch) {
      const year = new Date().getFullYear();
      return `${year}.${monthDayMatch[1]}.${monthDayMatch[2]}`;
    }
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}.${month}.${day}`;
}

function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src,
      success: resolve,
      fail: reject,
    });
  });
}

function canvasToTempFilePath(component, canvas, width, height) {
  return new Promise((resolve, reject) => {
    wx.canvasToTempFilePath({
      canvas,
      fileType: 'png',
      quality: 1,
      x: 0,
      y: 0,
      width,
      height,
      destWidth: width * 2,
      destHeight: height * 2,
      success: resolve,
      fail: reject,
    }, component);
  });
}

Component({
  properties: {
    mission: {
      type: String,
      value: '',
    },
    assets: {
      type: Object,
      value: null,
    },
    entries: {
      type: Array,
      value: [],
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
    placeholderText: {
      type: String,
      value: '今天先把这一刻留给自己。',
    },
    renderVersion: {
      type: Number,
      value: 0,
    },
    autoRender: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    imageSrc: '',
    isRendering: false,
  },

  observers: {
    renderVersion(renderVersion) {
      if (renderVersion > 0) {
        this.queueRender(true);
      }
    },
  },

  lifetimes: {
    attached() {
      this.imageCache = {};
      this.renderTimer = null;
      this.renderToken = 0;
      this.lastRenderKey = '';
    },
    ready() {
      this.initCanvas();
    },
    detached() {
      if (this.renderTimer) {
        clearTimeout(this.renderTimer);
      }
    },
  },

  methods: {
    queueRender() {
      const renderKey = JSON.stringify({
        mission: this.data.mission || '',
        noteText: this.data.assets && this.data.assets.noteText ? this.data.assets.noteText : '',
        companionNote: this.data.assets && this.data.assets.companionNote ? this.data.assets.companionNote : '',
        photoList: this.data.assets && Array.isArray(this.data.assets.photoList) ? this.data.assets.photoList : [],
        entries: Array.isArray(this.data.entries) ? this.data.entries : [],
        locationName: this.data.locationName || '',
        themeTitle: this.data.themeTitle || '',
        dateLabel: this.data.dateLabel || '',
        accentColor: this.data.accentColor || '',
        renderVersion: this.data.renderVersion || 0,
      });
      if (renderKey === this.lastRenderKey && this.data.imageSrc) {
        return;
      }
      this.lastRenderKey = renderKey;
      if (this.renderTimer) {
        clearTimeout(this.renderTimer);
      }
      this.renderTimer = setTimeout(() => {
        this.renderCard().catch(() => {
          if (this.ctx) {
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
          }
          this.setData({ isRendering: false });
        });
      }, 80);
    },

    initCanvas() {
      if (this.canvasReady) {
        if (this.data.autoRender && this.data.renderVersion > 0) {
          this.queueRender();
        }
        return;
      }
      const query = this.createSelectorQuery();
      query.select('#cardCanvas').fields({ node: true, size: true }).exec((result) => {
        const target = result && result[0];
        if (!target || !target.node) {
          return;
        }
        this.canvasNode = target.node;
        this.ctx = this.canvasNode.getContext('2d');
        this.canvasWidth = Math.round(target.width || CARD_WIDTH);
        this.dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : (wx.getSystemInfoSync().pixelRatio || 2);
        this.canvasReady = true;
        if (this.data.autoRender && this.data.renderVersion > 0) {
          this.queueRender();
        }
      });
    },

    async resolveSource(src) {
      if (!src) {
        return '';
      }
      if (this.imageCache[src]) {
        return this.imageCache[src];
      }
      let finalSrc = src;
      if (String(src).startsWith('cloud://') && wx.cloud && wx.cloud.getTempFileURL) {
        const tempResult = await wx.cloud.getTempFileURL({ fileList: [src] });
        const file = tempResult.fileList && tempResult.fileList[0];
        finalSrc = file && file.tempFileURL ? file.tempFileURL : '';
      }
      this.imageCache[src] = finalSrc;
      return finalSrc;
    },

    async loadCanvasImage(src) {
      const resolved = await this.resolveSource(src);
      if (!resolved) {
        return null;
      }
      const compatibleSrc = await ensureCanvasCompatibleImage(resolved).catch(() => resolved);
      const info = await getImageInfo(compatibleSrc);
      const image = this.canvasNode.createImage();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = info.path || compatibleSrc;
      });
      return {
        image,
        width: info.width,
        height: info.height,
      };
    },

    drawPaperBackground(width, height) {
      const ctx = this.ctx;
      ctx.save();
      roundRect(ctx, 0, 0, width, height, 24);
      ctx.clip();

      const baseGradient = ctx.createLinearGradient(0, 0, width, height);
      baseGradient.addColorStop(0, '#fff6e8');
      baseGradient.addColorStop(0.5, '#f8e8ca');
      baseGradient.addColorStop(1, '#f3d9ae');
      ctx.fillStyle = baseGradient;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.fillRect(0, 0, width, 56);
      ctx.restore();
    },

    drawPaw(x, y, scale, color) {
      const ctx = this.ctx;
      ctx.save();
      ctx.fillStyle = color;
      const dots = [
        { x: 0, y: 0, r: 4 * scale },
        { x: -9 * scale, y: -8 * scale, r: 2.9 * scale },
        { x: -2 * scale, y: -13 * scale, r: 2.7 * scale },
        { x: 5 * scale, y: -12 * scale, r: 2.7 * scale },
        { x: 11 * scale, y: -6 * scale, r: 2.8 * scale },
      ];
      dots.forEach((dot) => {
        ctx.beginPath();
        ctx.arc(x + dot.x, y + dot.y, dot.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    },

    drawSparkle(x, y, size, color) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.1;
      [[0, -size, 0, size], [-size, 0, size, 0], [-size * 0.65, -size * 0.65, size * 0.65, size * 0.65], [-size * 0.65, size * 0.65, size * 0.65, -size * 0.65]].forEach((line) => {
        ctx.beginPath();
        ctx.moveTo(line[0], line[1]);
        ctx.lineTo(line[2], line[3]);
        ctx.stroke();
      });
      ctx.restore();
    },

    drawTape(x, y, width, height, rotation, color) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      roundRect(ctx, -width / 2, -height / 2, width, height, 4);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.stroke();
      ctx.restore();
    },

    drawFishbone(x, y, color) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(x, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
      [[-8, 0, -13, -5], [-1, 0, -6, -6], [-8, 0, -13, 5], [-1, 0, -6, 6]].forEach((line) => {
        ctx.beginPath();
        ctx.moveTo(line[0], line[1]);
        ctx.lineTo(line[2], line[3]);
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(16, -4);
      ctx.lineTo(16, 4);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-15.5, 0, 2.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    },

    drawAirmailString(width) {
      const ctx = this.ctx;
      const y = 138;
      ctx.save();
      ctx.lineWidth = 2;
      const segments = 22;
      for (let index = 0; index < segments; index += 1) {
        const startX = 20 + ((width - 40) / segments) * index;
        const endX = 20 + ((width - 40) / segments) * (index + 1);
        ctx.strokeStyle = index % 2 === 0 ? 'rgba(203, 86, 63, 0.72)' : 'rgba(72, 118, 184, 0.72)';
        ctx.beginPath();
        ctx.moveTo(startX, y + (index % 2 === 0 ? 0 : 1.5));
        ctx.lineTo(endX, y + (index % 2 === 0 ? 1.5 : 0));
        ctx.stroke();
      }
      ctx.restore();
    },

    drawRoutingMarks(width) {
      const ctx = this.ctx;
      ctx.save();
      ctx.strokeStyle = 'rgba(131, 95, 62, 0.42)';
      ctx.lineWidth = 1.2;
      [[22, 112, 42, 112], [22, 118, 38, 118], [width - 52, 122, width - 22, 122]].forEach((line) => {
        ctx.beginPath();
        ctx.moveTo(line[0], line[1]);
        ctx.lineTo(line[2], line[3]);
        ctx.stroke();
      });
      ctx.restore();
    },

    drawMailBadge({ x, y, text, color = '#4e79b5', rotation = -0.18, width = 70, height = 28 }) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      roundRect(ctx, -width / 2, -height / 2, width, height, 6);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = `${color}18`;
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 1);
      ctx.restore();
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    },

    drawAddressBlock(width) {
      const ctx = this.ctx;
      ctx.save();
      const blockX = width - 134;
      const blockY = 34;
      roundRect(ctx, blockX, blockY, 96, 54, 10);
      ctx.fillStyle = 'rgba(255, 249, 238, 0.42)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(147, 111, 76, 0.18)';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(138, 105, 74, 0.26)';
      ctx.lineWidth = 1;
      [blockY + 17, blockY + 28, blockY + 39].forEach((lineY) => {
        ctx.beginPath();
        ctx.moveTo(blockX + 12, lineY);
        ctx.lineTo(blockX + 84, lineY);
        ctx.stroke();
      });
      ctx.fillStyle = 'rgba(112, 85, 59, 0.58)';
      ctx.font = '10px monospace';
      ctx.fillText('AIR MAIL NOTE', blockX + 12, blockY + 52);
      ctx.restore();
    },

    drawStampWithPerforation(x, y, accentColor) {
      const ctx = this.ctx;
      const stampWidth = 56;
      const stampHeight = 72;
      ctx.save();
      ctx.fillStyle = 'rgba(255, 245, 227, 0.86)';
      drawPerforationEdge(ctx, x, y, stampWidth, stampHeight, 2.5, 7);
      roundRect(ctx, x, y, stampWidth, stampHeight, 4);
      ctx.fillStyle = '#a7c7df';
      ctx.fill();

      roundRect(ctx, x + 8, y + 7, 40, 56, 4);
      const stampGradient = ctx.createLinearGradient(x + 8, y + 7, x + 48, y + 63);
      stampGradient.addColorStop(0, accentColor);
      stampGradient.addColorStop(1, '#bb5131');
      ctx.fillStyle = stampGradient;
      ctx.fill();

      ctx.fillStyle = '#fff8ef';
      ctx.font = 'bold 8px sans-serif';
      ctx.fillText('POST', x + 15, y + 28);
      ctx.font = 'bold 21px sans-serif';
      ctx.fillText('66', x + 15, y + 50);
      ctx.font = 'bold 10px monospace';
      ctx.fillText('84', x + 28, y + 64);
      ctx.restore();
    },

    drawInkStamp({ x, y, radius = 22, color = 'rgba(195, 87, 58, 0.72)', text = 'CITY WALK' }) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.28);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, radius - 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 1);
      ctx.restore();
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    },

    drawHeader(width, accentColor) {
      const ctx = this.ctx;
      ctx.save();

      roundRect(ctx, 18, 18, width - 36, HEADER_HEIGHT - 20, 20);
      const headerGradient = ctx.createLinearGradient(18, 18, width - 18, HEADER_HEIGHT);
      headerGradient.addColorStop(0, 'rgba(255,255,255,0.72)');
      headerGradient.addColorStop(1, 'rgba(255,241,214,0.46)');
      ctx.fillStyle = headerGradient;
      ctx.fill();
      this.drawStampWithPerforation(28, 28, accentColor);
      this.drawAddressBlock(width);

      ctx.fillStyle = '#8e6b47';
      ctx.font = '12px "ZCOOL XiaoWei", serif';
      ctx.fillText('66 陪你记录这一站', 96, 42);

      ctx.fillStyle = '#1f1b16';
      ctx.font = 'bold 20px "ZCOOL KuaiLe", sans-serif';
      const themeLines = splitTextToLines(ctx, this.data.themeTitle || '今日漫步', 196).slice(0, 2);
      themeLines.forEach((line, index) => {
        fillTextWithSpacing(ctx, line, 96, 68 + index * 24, 1.2);
      });

      ctx.fillStyle = 'rgba(74, 57, 43, 0.74)';
      ctx.font = '12px "ZCOOL XiaoWei", serif';
      const missionLines = splitTextToLines(ctx, this.data.mission || '打卡任务', 174).slice(0, 2);
      ctx.fillText('任务：', 96, 116);
      missionLines.forEach((line, index) => {
        ctx.fillText(line, 132, 116 + index * 18);
      });

      this.drawAirmailString(width);
      this.drawRoutingMarks(width);
      this.drawPaw(108, 108, 0.7, 'rgba(207, 131, 91, 0.24)');
      this.drawPaw(132, 102, 0.55, 'rgba(207, 131, 91, 0.18)');
      this.drawSparkle(width - 26, 34, 5, 'rgba(201, 111, 74, 0.48)');
      this.drawSparkle(width - 36, 100, 4, 'rgba(141, 106, 73, 0.32)');
      this.drawTape(108, 24, 38, 12, -0.12, 'rgba(255, 243, 201, 0.72)');
      this.drawTape(width - 48, 22, 42, 12, 0.1, 'rgba(255, 238, 207, 0.68)');
      this.drawMailBadge({ x: width - 66, y: 84, text: 'LINE 66', color: '#4f80bd', rotation: -0.95, width: 76, height: 28 });
      this.drawMailBadge({ x: width - 122, y: 54, text: 'AIR', color: '#7f69ae', rotation: -0.28, width: 48, height: 24 });
      this.drawInkStamp({ x: 116, y: 40, radius: 21, text: 'POST' });

      ctx.restore();
    },

    drawCompanionAvatar(x, y, size) {
      const ctx = this.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      const avatarGradient = ctx.createLinearGradient(x, y, x + size, y + size);
      avatarGradient.addColorStop(0, '#f5d9b5');
      avatarGradient.addColorStop(1, '#e5a676');
      ctx.fillStyle = avatarGradient;
      ctx.fillRect(x, y, size, size);
      ctx.fillStyle = '#fff7ef';
      ctx.font = `bold ${Math.round(size * 0.34)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('66', x + size / 2, y + size / 2 + 1);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(194, 93, 57, 0.34)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size / 2 + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    },

    drawDialogueBubble({ x, y, width, height, fill, stroke, align = 'left', tailColor }) {
      const ctx = this.ctx;
      ctx.save();
      roundRect(ctx, x, y, width, height, 18);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      if (align === 'left') {
        ctx.moveTo(x + 28, y + height);
        ctx.lineTo(x + 22, y + height + 12);
        ctx.lineTo(x + 42, y + height - 2);
      } else {
        ctx.moveTo(x + width - 28, y + height);
        ctx.lineTo(x + width - 18, y + height + 12);
        ctx.lineTo(x + width - 46, y + height - 2);
      }
      ctx.closePath();
      ctx.fillStyle = tailColor || fill;
      ctx.fill();
      ctx.restore();
    },

    normalizePhotoSources(photoList) {
      return Array.isArray(photoList)
        ? photoList
            .map((item) => {
              if (typeof item === 'string') {
                return item;
              }
              return item && item.tempFilePath ? item.tempFilePath : '';
            })
            .filter(Boolean)
        : [];
    },

    buildRenderEntries() {
      const providedEntries = Array.isArray(this.data.entries) ? this.data.entries : [];
      if (providedEntries.length) {
        return providedEntries.map((entry, index) => {
          const authorName = String(
            (entry && (entry.authorName || entry.nickName || entry.name)) || `队友 ${index + 1}`
          ).trim() || `队友 ${index + 1}`;
          return {
            authorName,
            authorShort: authorName.slice(0, 1) || '友',
            userLabel: String((entry && entry.userLabel) || `${authorName} 的记录`).trim() || `${authorName} 的记录`,
            catLabel: String((entry && entry.catLabel) || '小猫66 的记录').trim() || '小猫66 的记录',
            noteText: String((entry && entry.noteText) || '').trim(),
            companionNote: String((entry && entry.companionNote) || '').trim(),
            photoSources: this.normalizePhotoSources(entry && entry.photoList),
          };
        });
      }

      const assets = this.data.assets || {};
      return [{
        authorName: '我',
        authorShort: '我',
        userLabel: '我的记录',
        catLabel: '小猫66 的记录',
        noteText: String(assets.noteText || '').trim(),
        companionNote: String(assets.companionNote || '').trim(),
        photoSources: this.normalizePhotoSources(assets.photoList),
      }];
    },

    drawDialogueSection(width, startY, userLayout, companionLayout, options = {}) {
      const ctx = this.ctx;
      let y = startY;
      const userLabel = String(options.userLabel || '我的记录');
      const userSign = String(options.userSign || '我');
      const catLabel = String(options.catLabel || '小猫66 的记录');
      const catSign = String(options.catSign || '66');

      const sections = [
        {
          label: userLabel,
          sign: userSign,
          layout: userLayout,
          align: 'left',
          width: 212,
          fill: 'rgba(255, 250, 243, 0.94)',
          stroke: 'rgba(205, 172, 132, 0.65)',
          titleColor: '#9b6a3f',
          textColor: '#46372d',
        },
        {
          label: catLabel,
          sign: catSign,
          layout: companionLayout,
          align: 'right',
          width: 214,
          fill: 'rgba(255, 238, 222, 0.96)',
          stroke: 'rgba(201, 111, 74, 0.55)',
          titleColor: '#c25d39',
          textColor: '#553729',
        },
      ];

      sections.forEach((section, index) => {
        const bubbleWidth = Math.min(section.width, width - SIDE_PADDING * 2 - 18);
        const lineCount = Math.max(section.layout.lines.length, 1);
        const bubbleHeight = BUBBLE_PADDING_Y * 2 + 16 + lineCount * section.layout.lineHeight + 6;
        const bubbleX = section.align === 'left' ? SIDE_PADDING + 2 : width - SIDE_PADDING - bubbleWidth - 4;

        ctx.save();
        ctx.fillStyle = section.titleColor;
        ctx.font = 'bold 12px "ZCOOL KuaiLe", sans-serif';
        if (section.align === 'left') {
          fillTextWithSpacing(ctx, `${section.sign} ${section.label}`, bubbleX + 6, y - 8, 0.8);
        } else {
          const labelText = `${section.label} ${section.sign}`;
          const labelWidth = ctx.measureText(labelText).width + (labelText.length - 1) * 0.8;
          fillTextWithSpacing(ctx, labelText, bubbleX + bubbleWidth - labelWidth - 6, y - 8, 0.8);
        }
        ctx.restore();

        this.drawDialogueBubble({
          x: bubbleX,
          y,
          width: bubbleWidth,
          height: bubbleHeight,
          fill: section.fill,
          stroke: section.stroke,
          align: section.align,
          tailColor: section.fill,
        });

        ctx.save();
        ctx.fillStyle = section.textColor;
        ctx.font = section.layout.font;
        section.layout.lines.forEach((line, lineIndex) => {
          ctx.fillText(line, bubbleX + BUBBLE_PADDING_X, y + BUBBLE_PADDING_Y + 18 + lineIndex * section.layout.lineHeight);
        });
        ctx.restore();

        if (index === 1) {
          this.drawCompanionAvatar(bubbleX - 54, y + 18, 46);
          this.drawPaw(bubbleX + bubbleWidth - 14, y - 12, 0.42, 'rgba(194, 93, 57, 0.22)');
          this.drawSparkle(bubbleX + 18, y + bubbleHeight - 8, 3.2, 'rgba(194, 93, 57, 0.24)');
        }
        if (index === 0) {
          this.drawSparkle(width / 2 - 8, y + bubbleHeight / 2, 4.5, 'rgba(194, 93, 57, 0.18)');
          this.drawPaw(width / 2 + 14, y + bubbleHeight / 2 + 12, 0.38, 'rgba(142, 107, 71, 0.14)');
        }
        y += bubbleHeight + 34;
      });

      return y;
    },

    drawEntryDivider(width, top) {
      const ctx = this.ctx;
      ctx.save();
      ctx.setLineDash([6, 8]);
      ctx.strokeStyle = 'rgba(145, 111, 79, 0.24)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(SIDE_PADDING + 10, top);
      ctx.lineTo(width - SIDE_PADDING - 10, top);
      ctx.stroke();
      ctx.setLineDash([]);
      this.drawPaw(width / 2 - 10, top + 6, 0.34, 'rgba(142, 107, 71, 0.14)');
      this.drawSparkle(width / 2 + 16, top - 4, 3, 'rgba(194, 93, 57, 0.2)');
      ctx.restore();
    },

    drawPhoto(width, photoTop, photoHeight, photoImage) {
      const ctx = this.ctx;
      const photoWidth = width - SIDE_PADDING * 2;
      ctx.save();
      roundRect(ctx, SIDE_PADDING, photoTop, photoWidth, photoHeight, 16);
      ctx.clip();

      if (photoImage) {
        const imageRatio = photoImage.width / photoImage.height;
        const boxRatio = photoWidth / photoHeight;
        let drawWidth = photoWidth;
        let drawHeight = photoHeight;
        let dx = SIDE_PADDING;
        let dy = photoTop;
        if (imageRatio > boxRatio) {
          drawHeight = photoHeight;
          drawWidth = drawHeight * imageRatio;
          dx -= (drawWidth - photoWidth) / 2;
        } else {
          drawWidth = photoWidth;
          drawHeight = drawWidth / imageRatio;
          dy -= (drawHeight - photoHeight) / 2;
        }
        ctx.drawImage(photoImage.image, dx, dy, drawWidth, drawHeight);
      } else {
        const placeholder = ctx.createLinearGradient(SIDE_PADDING, photoTop, SIDE_PADDING, photoTop + photoHeight);
        placeholder.addColorStop(0, '#f1d8b0');
        placeholder.addColorStop(1, '#d3a37a');
        ctx.fillStyle = placeholder;
        ctx.fillRect(SIDE_PADDING, photoTop, photoWidth, photoHeight);
      }

      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(SIDE_PADDING, photoTop, photoWidth, 42);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(255, 252, 246, 0.88)';
      ctx.lineWidth = 6;
      roundRect(ctx, SIDE_PADDING + 3, photoTop + 3, photoWidth - 6, photoHeight - 6, 14);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(145, 111, 79, 0.18)';
      ctx.lineWidth = 1.2;
      roundRect(ctx, SIDE_PADDING + 8, photoTop + 8, photoWidth - 16, photoHeight - 16, 10);
      ctx.stroke();
      ctx.restore();
    },

    drawPhotos(width, photoTop, photoLayouts) {
      let currentTop = photoTop;
      photoLayouts.forEach((layout, index) => {
        this.drawPhoto(width, currentTop, layout.height, layout.photoImage);
        this.drawTape(SIDE_PADDING + 34, currentTop + 16, 28, 10, -0.18, 'rgba(255, 244, 214, 0.78)');
        this.drawTape(width - SIDE_PADDING - 34, currentTop + 18, 30, 10, 0.18, 'rgba(255, 236, 206, 0.72)');
        currentTop += layout.height;
        if (index < photoLayouts.length - 1) {
          currentTop += PHOTO_GAP;
        }
      });
      return currentTop;
    },

    drawFooter(width, dateText) {
      const ctx = this.ctx;
      const footerY = this.cardHeight - 34;

      ctx.save();
      roundRect(ctx, SIDE_PADDING, footerY - 12, 100, 24, 12);
      ctx.fillStyle = 'rgba(255,247,233,0.96)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(149, 112, 78, 0.24)';
      ctx.stroke();
      ctx.fillStyle = '#75573a';
      ctx.font = '10px monospace';
      ctx.fillText(dateText, SIDE_PADDING + 10, footerY + 4);

      roundRect(ctx, width - 118, footerY - 8, 56, 20, 10);
      ctx.fillStyle = 'rgba(255, 247, 233, 0.94)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(149, 112, 78, 0.2)';
      ctx.stroke();
      ctx.fillStyle = '#7e6144';
      ctx.font = 'bold 9px monospace';
      ctx.fillText('BY AIR', width - 105, footerY + 5);

      ctx.fillStyle = 'rgba(99, 75, 54, 0.78)';
      ctx.font = '11px "ZCOOL XiaoWei", serif';
      ctx.fillText(this.data.locationName || '城市街角', SIDE_PADDING + 114, footerY + 3);
      ctx.font = '11px "ZCOOL KuaiLe", sans-serif';
      fillTextWithSpacing(ctx, '66 陪伴记录卡', SIDE_PADDING, footerY + 23, 0.7);
      this.drawFishbone(width - 112, footerY + 10, 'rgba(193, 136, 84, 0.55)');
      this.drawSparkle(width - 144, footerY + 2, 3.6, 'rgba(201, 111, 74, 0.32)');
      this.drawMailBadge({ x: width - 74, y: footerY + 8, text: 'SORT', color: '#4d78b0', rotation: -0.14, width: 42, height: 18 });

      ctx.restore();
    },

    async renderCard() {
      if (!this.canvasReady || !this.canvasNode || !this.ctx) {
        return;
      }

      const token = Date.now();
      this.renderToken = token;
      this.setData({ isRendering: true });

      const placeholderText = String(this.data.placeholderText || '').trim();
      const renderEntries = this.buildRenderEntries();
      const width = this.canvasWidth || CARD_WIDTH;
      const contentWidth = width - SIDE_PADDING * 2;

      const entryLayouts = await Promise.all(renderEntries.map(async (entry) => {
        const userNote = String(entry.noteText || '').trim() || placeholderText;
        const companionNote = String(entry.companionNote || '').trim() || '66 轻轻跟在一旁，把你停下来注视的那一刻也记在了心里。';
        const loadedPhotos = await Promise.all(
          (entry.photoSources || []).map((src) => this.loadCanvasImage(src).catch(() => null))
        );
        const photoLayouts = loadedPhotos
          .filter(Boolean)
          .map((photoImage) => {
            const imageRatio = photoImage.width / photoImage.height;
            return {
              photoImage,
              height: clamp(contentWidth / imageRatio, 150, 280),
            };
          })
          .slice(0, 2);

        const userLayout = layoutParagraph(this.ctx, userNote, {
          maxWidth: 212 - BUBBLE_PADDING_X * 2,
          preferredSize: 15,
          minSize: 12,
          maxLines: 6,
          family: '"ZCOOL XiaoWei", "KaiTi", "STKaiti", serif',
          lineHeightRatio: 1.78,
        });
        const companionLayout = layoutParagraph(this.ctx, companionNote, {
          maxWidth: 214 - BUBBLE_PADDING_X * 2,
          preferredSize: 14,
          minSize: 11,
          maxLines: 8,
          family: '"ZCOOL XiaoWei", "KaiTi", "STKaiti", serif',
          lineHeightRatio: 1.84,
        });
        const dialogueHeight =
          (Math.max(userLayout.lines.length, 1) * userLayout.lineHeight + BUBBLE_PADDING_Y * 2 + 22 + 34) +
          (Math.max(companionLayout.lines.length, 1) * companionLayout.lineHeight + BUBBLE_PADDING_Y * 2 + 22 + 34);
        const photoBlockHeight = photoLayouts.length
          ? photoLayouts.reduce((total, item) => total + item.height, 0) + (photoLayouts.length - 1) * PHOTO_GAP + 18
          : 0;

        return {
          ...entry,
          userLayout,
          companionLayout,
          photoLayouts,
          blockHeight: dialogueHeight + photoBlockHeight,
        };
      }));

      const entryGap = entryLayouts.length > 1 ? 30 : 0;
      const totalBodyHeight = entryLayouts.reduce((total, entry) => total + entry.blockHeight, 0)
        + Math.max(0, entryLayouts.length - 1) * entryGap;
      this.cardHeight = HEADER_HEIGHT + 18 + totalBodyHeight + 62;

      const dpr = this.dpr || 2;
      this.canvasNode.width = width * dpr;
      this.canvasNode.height = this.cardHeight * dpr;
      this.ctx.scale(dpr, dpr);
      this.ctx.clearRect(0, 0, width, this.cardHeight);

      const accentColor = this.data.accentColor || '#c96f4a';
      this.drawPaperBackground(width, this.cardHeight);
      this.drawHeader(width, accentColor);
      let nextTop = HEADER_HEIGHT + 24;
      entryLayouts.forEach((entry, index) => {
        nextTop = this.drawDialogueSection(width, nextTop, entry.userLayout, entry.companionLayout, {
          userLabel: entry.userLabel,
          userSign: entry.authorShort,
          catLabel: entry.catLabel,
          catSign: '66',
        });

        if (entry.photoLayouts.length) {
          this.ctx.save();
          this.ctx.fillStyle = '#8e6b47';
          this.ctx.font = 'bold 11px sans-serif';
          this.ctx.fillText(`${entry.authorName} 拍下的样子`, SIDE_PADDING, nextTop - 6);
          this.ctx.restore();
          nextTop = this.drawPhotos(width, nextTop + 8, entry.photoLayouts) + 18;
        }

        if (index < entryLayouts.length - 1) {
          this.drawEntryDivider(width, nextTop + 2);
          nextTop += entryGap;
        }
      });

      this.drawFooter(width, formatCardDate(this.data.dateLabel));

      if (this.renderToken !== token) {
        return;
      }

      const tempResult = await canvasToTempFilePath(this, this.canvasNode, width, this.cardHeight);
      if (this.renderToken !== token) {
        return;
      }
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.setData({
        imageSrc: tempResult.tempFilePath,
        isRendering: false,
      });
      this.triggerEvent('generated', {
        tempFilePath: tempResult.tempFilePath,
        mission: this.data.mission,
      });
    },
  },
});

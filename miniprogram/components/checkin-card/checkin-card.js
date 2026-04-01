const PAPER_TEXTURE = '/assets/images/checkin-card/paper-texture.png';
const POSTMARK = '/assets/images/checkin-card/postmark-generated.png';
const BARCODE = '/assets/images/checkin-card/barcode-generated.png';
const { ensureCanvasCompatibleImage } = require('../../utils/media');

const CARD_WIDTH = 327;
const SIDE_PADDING = 26;
const TOP_DECORATION_HEIGHT = 118;
const TEXT_TOP_GAP = 22;
const TITLE_FONT = 24;
const META_FONT = 11;
const BODY_FONT = 14;
const BODY_LINE_HEIGHT = 24;
const BOTTOM_META_GAP = 22;
const PHOTO_GAP = 14;

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

function formatCardDate(rawValue) {
  if (rawValue) {
    return String(rawValue).replace(/\//g, '.').replace(/-/g, '.');
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}.${month}${day}`;
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
      value: '',
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
    'renderVersion': function onRenderVersionChange(renderVersion) {
      if (renderVersion > 0) {
        this.queueRender();
      }
    },
    'mission, assets, locationName, themeTitle, dateLabel, accentColor, placeholderText, autoRender': function schedule() {
      if (this.data.autoRender) {
        this.queueRender();
      }
    },
  },

  lifetimes: {
    attached() {
      this.imageCache = {};
      this.renderTimer = null;
      this.renderToken = 0;
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
      if (this.renderTimer) {
        clearTimeout(this.renderTimer);
      }
      this.renderTimer = setTimeout(() => {
        this.renderCard().catch(() => {
          this.setData({ isRendering: false });
        });
      }, 80);
    },

    initCanvas() {
      if (this.canvasReady) {
        this.queueRender();
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
        this.queueRender();
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
      roundRect(ctx, 0, 0, width, height, 22);
      ctx.clip();

      const baseGradient = ctx.createLinearGradient(0, 0, 0, height);
      baseGradient.addColorStop(0, '#f6e7c5');
      baseGradient.addColorStop(1, '#f3d8ab');
      ctx.fillStyle = baseGradient;
      ctx.fillRect(0, 0, width, height);

      ctx.globalAlpha = 0.12;
      if (this.paperTextureImage) {
        ctx.drawImage(this.paperTextureImage.image, 0, 0, width, height);
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(0, 0, width, 32);
      ctx.restore();
    },

    drawAirmailDivider(width) {
      const ctx = this.ctx;
      const y = TOP_DECORATION_HEIGHT;
      ctx.save();
      ctx.lineWidth = 2;
      const colors = ['#d95a4b', '#f6f0e6', '#3767b1'];
      for (let index = 0; index < 28; index += 1) {
        const startX = -8 + index * 14;
        ctx.strokeStyle = colors[index % colors.length];
        ctx.beginPath();
        ctx.moveTo(startX, y + 6);
        ctx.lineTo(startX + 18, y - 2);
        ctx.stroke();
      }
      ctx.restore();
    },

    drawHeader(width, accentColor) {
      const ctx = this.ctx;
      ctx.save();

      roundRect(ctx, 20, 18, 58, 74, 4);
      ctx.fillStyle = '#9fc0dc';
      ctx.fill();

      roundRect(ctx, 29, 26, 40, 58, 2);
      ctx.fillStyle = accentColor;
      ctx.fill();

      ctx.fillStyle = '#fff8eb';
      ctx.font = 'bold 8px sans-serif';
      ctx.fillText('POST', 36, 50);
      ctx.font = 'bold 19px sans-serif';
      ctx.fillText('84', 36, 76);

      if (this.postmarkImage) {
        ctx.translate(width - 92, 48);
        ctx.rotate(-0.22);
        ctx.globalAlpha = 0.84;
        ctx.drawImage(this.postmarkImage.image, -62, -62, 124, 124);
        ctx.globalAlpha = 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }

      ctx.strokeStyle = 'rgba(87, 53, 35, 0.14)';
      ctx.strokeRect(14, 14, width - 28, this.cardHeight - 28);
      ctx.restore();
    },

    drawTextBlocks(width, title, noteLines, locationName, themeTitle, dateText) {
      const ctx = this.ctx;
      const contentWidth = width - SIDE_PADDING * 2;
      let y = TOP_DECORATION_HEIGHT + TEXT_TOP_GAP;

      ctx.save();
      ctx.fillStyle = '#1e1c18';
      ctx.font = `700 ${TITLE_FONT}px serif`;
      const titleLines = splitTextToLines(ctx, title, contentWidth);
      titleLines.forEach((line, index) => {
        ctx.fillText(line, SIDE_PADDING, y + index * 32);
      });
      y += titleLines.length * 32 + 18;

      ctx.fillStyle = '#453b31';
      ctx.font = `${BODY_FONT}px sans-serif`;
      const bodyLines = noteLines.length ? noteLines : splitTextToLines(ctx, this.data.placeholderText, contentWidth);
      bodyLines.forEach((line, index) => {
        ctx.fillText(line, SIDE_PADDING, y + index * BODY_LINE_HEIGHT);
      });
      y += bodyLines.length * BODY_LINE_HEIGHT + 18;

      ctx.fillStyle = 'rgba(62, 52, 42, 0.72)';
      ctx.font = `${META_FONT}px sans-serif`;
      ctx.fillText(themeTitle || '今日漫步任务', SIDE_PADDING, y);
      ctx.textAlign = 'right';
      ctx.fillText(locationName || '城市街角', width - SIDE_PADDING, y);
      ctx.textAlign = 'left';
      y += 12;

      return {
        photoTop: y + 14,
        footerTop: this.cardHeight - 42,
        dateText,
      };
    },

    drawPhoto(width, photoTop, photoHeight, photoImage) {
      const ctx = this.ctx;
      const photoWidth = width - SIDE_PADDING * 2;

      ctx.save();
      roundRect(ctx, SIDE_PADDING, photoTop, photoWidth, photoHeight, 4);
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
        placeholder.addColorStop(0, '#d3dce4');
        placeholder.addColorStop(1, '#8ea1ad');
        ctx.fillStyle = placeholder;
        ctx.fillRect(SIDE_PADDING, photoTop, photoWidth, photoHeight);
      }

      ctx.globalAlpha = 0.14;
      if (this.paperTextureImage) {
        ctx.drawImage(this.paperTextureImage.image, SIDE_PADDING, photoTop, photoWidth, photoHeight);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    },

    drawPhotos(width, photoTop, photoLayouts) {
      let currentTop = photoTop;
      photoLayouts.forEach((layout, index) => {
        this.drawPhoto(width, currentTop, layout.height, layout.photoImage);
        currentTop += layout.height;
        if (index < photoLayouts.length - 1) {
          currentTop += PHOTO_GAP;
        }
      });
    },

    drawFooter(width, dateText) {
      const ctx = this.ctx;
      const footerY = this.cardHeight - 30;

      ctx.save();
      roundRect(ctx, SIDE_PADDING, footerY - 12, 66, 20, 10);
      ctx.fillStyle = 'rgba(255, 241, 214, 0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(95, 75, 54, 0.25)';
      ctx.stroke();
      ctx.fillStyle = '#785f42';
      ctx.font = '10px monospace';
      ctx.fillText(dateText, SIDE_PADDING + 8, footerY + 2);

      ctx.font = '10px sans-serif';
      ctx.fillStyle = 'rgba(116, 93, 70, 0.7)';
      ctx.fillText('@ 遛遛地图实验室', SIDE_PADDING, footerY + 20);

      if (this.barcodeImage) {
        ctx.translate(width - 58, this.cardHeight - 42);
        ctx.rotate(-0.14);
        ctx.globalAlpha = 0.9;
        ctx.drawImage(this.barcodeImage.image, -56, -20, 112, 40);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    },

    async renderCard() {
      if (!this.canvasReady || !this.canvasNode || !this.ctx) {
        return;
      }

      const token = Date.now();
      this.renderToken = token;
      this.setData({ isRendering: true });

      const assets = this.data.assets || {};
      const photoSources = Array.isArray(assets.photoList)
        ? assets.photoList
            .map((item) => {
              if (typeof item === 'string') {
                return item;
              }
              return item && item.tempFilePath ? item.tempFilePath : '';
            })
            .filter(Boolean)
        : [];
      const noteText = assets.noteText || '';
      const width = this.canvasWidth || CARD_WIDTH;

      this.paperTextureImage = await this.loadCanvasImage(PAPER_TEXTURE).catch(() => null);
      this.postmarkImage = await this.loadCanvasImage(POSTMARK).catch(() => null);
      this.barcodeImage = await this.loadCanvasImage(BARCODE).catch(() => null);
      const loadedPhotos = await Promise.all(
        photoSources.map((src) => this.loadCanvasImage(src).catch(() => null))
      );
      const photoLayouts = loadedPhotos
        .filter(Boolean)
        .map((photoImage) => {
          const imageRatio = photoImage.width / photoImage.height;
          return {
            photoImage,
            height: clamp((width - SIDE_PADDING * 2) / imageRatio, 148, 356),
          };
        });

      this.ctx.font = `${BODY_FONT}px sans-serif`;
      const contentWidth = width - SIDE_PADDING * 2;
      const noteLines = splitTextToLines(this.ctx, noteText, contentWidth);
      const fallbackLines = splitTextToLines(this.ctx, this.data.placeholderText, contentWidth);
      const titleLines = splitTextToLines(this.ctx, this.data.mission || '任务卡片', contentWidth);
      const renderedBodyLineCount = Math.max(noteLines.length || fallbackLines.length, 1);
      const photoBlockHeight = photoLayouts.length
        ? photoLayouts.reduce((total, item) => total + item.height, 0) + (photoLayouts.length - 1) * PHOTO_GAP
        : 0;
      this.cardHeight =
        TOP_DECORATION_HEIGHT +
        TEXT_TOP_GAP +
        titleLines.length * 32 +
        18 +
        renderedBodyLineCount * BODY_LINE_HEIGHT +
        18 +
        26 +
        photoBlockHeight +
        BOTTOM_META_GAP +
        44;

      const dpr = this.dpr || 2;
      this.canvasNode.width = width * dpr;
      this.canvasNode.height = this.cardHeight * dpr;
      this.ctx.scale(dpr, dpr);
      this.ctx.clearRect(0, 0, width, this.cardHeight);

      const accentColor = this.data.accentColor || '#c96f4a';
      this.drawPaperBackground(width, this.cardHeight);
      this.drawHeader(width, accentColor);
      this.drawAirmailDivider(width);
      const textLayout = this.drawTextBlocks(
        width,
        this.data.mission || '任务卡片',
        noteLines,
        this.data.locationName,
        this.data.themeTitle,
        formatCardDate(this.data.dateLabel)
      );
      if (photoLayouts.length) {
        this.drawPhotos(width, textLayout.photoTop, photoLayouts);
      }
      this.drawFooter(width, textLayout.dateText);

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

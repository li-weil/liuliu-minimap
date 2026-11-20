const { VIEW_W, VIEW_H, COASTLINE, GUIDE_POINTS, GUIDE_ROUTES } = require('./island-map-data');

// 画布色板：与小程序整体暖色基底一致；手绘底图加载失败时作为兜底绘制
const COLORS = {
  seaTop: '#d8ece8',
  seaBottom: '#c2e0da',
  islandFill: '#f3e8cf',
  islandEdge: '#c9b892',
  routeLine: '#a8946e',
  pointFill: '#fffdf8',
  pointEdge: '#626247',
  pointSelected: '#626247',
  label: '#4c453a',
  labelHalo: '#fdfbf5',
};

const MAP_BG = '/images/map-island.jpg';
const TAP_RADIUS = 34; // viewBox 单位下的点选命中半径
const ICON_SIZE = 32; // viewBox 单位下的点位图标尺寸（贴纸白边内约 26）

Component({
  properties: {
    selectedId: {
      type: String,
      value: '',
    },
  },

  observers: {
    selectedId() {
      this._scheduleRedraw();
    },
  },

  lifetimes: {
    attached() {
      this._canvas = null;
      this._ctx = null;
      this._rect = null;
      this._redrawTimer = null;
      this._bgImage = null;
      this._pointImages = {};
    },

    ready() {
      this._initCanvas();
    },

    detached() {
      if (this._redrawTimer) {
        clearTimeout(this._redrawTimer);
        this._redrawTimer = null;
      }
    },
  },

  methods: {
    _initCanvas() {
      const query = this.createSelectorQuery();
      query.select('#islandCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const entry = res && res[0];
          if (!entry || !entry.node) return;
          const canvas = entry.node;
          const dpr = (wx.getWindowInfo && wx.getWindowInfo().pixelRatio) || 2;
          canvas.width = Math.round(entry.width * dpr);
          canvas.height = Math.round(entry.height * dpr);
          this._canvas = canvas;
          this._ctx = canvas.getContext('2d');
          this._rect = { width: entry.width, height: entry.height };
          this._dpr = dpr;
          this._loadImages(canvas);
          this._draw();
        });
    },

    // 预加载手绘底图与点位图标；每张就绪后重绘一次，未就绪时走兜底绘制
    _loadImages(canvas) {
      const load = (src, key) => {
        const img = canvas.createImage();
        img.onload = () => {
          if (key) {
            this._pointImages[key] = img;
          } else {
            this._bgImage = img;
          }
          this._scheduleRedraw();
        };
        img.onerror = () => {};
        img.src = src;
      };
      load(MAP_BG, '');
      GUIDE_POINTS.forEach((point) => {
        if (point.icon) load(`/images/${point.icon}.png`, point.id);
      });
    },

    _scheduleRedraw() {
      if (!this._ctx) return;
      if (this._redrawTimer) clearTimeout(this._redrawTimer);
      this._redrawTimer = setTimeout(() => {
        this._redrawTimer = null;
        this._draw();
      }, 30);
    },

    // 底图按 cover 方式铺满画布（方形源图上下对称裁切）
    _drawBackground(ctx, rect) {
      if (this._bgImage) {
        const iw = this._bgImage.width;
        const ih = this._bgImage.height;
        const scale = Math.max(rect.width / iw, rect.height / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        ctx.drawImage(this._bgImage, (rect.width - dw) / 2, (rect.height - dh) / 2, dw, dh);
        return;
      }
      // 兜底：海面渐变 + 米色岛屿
      const seaGrad = ctx.createLinearGradient(0, 0, 0, rect.height);
      seaGrad.addColorStop(0, COLORS.seaTop);
      seaGrad.addColorStop(1, COLORS.seaBottom);
      ctx.fillStyle = seaGrad;
      ctx.fillRect(0, 0, rect.width, rect.height);
      const k = rect.width / VIEW_W;
      ctx.beginPath();
      COASTLINE.forEach((p, i) => {
        const x = p[0] * k;
        const y = p[1] * k;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = COLORS.islandFill;
      ctx.fill();
      ctx.lineWidth = 1.5 * k;
      ctx.strokeStyle = COLORS.islandEdge;
      ctx.stroke();
    },

    _draw() {
      const ctx = this._ctx;
      const rect = this._rect;
      if (!ctx || !rect) return;
      const k = rect.width / VIEW_W; // viewBox -> css px
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      this._drawBackground(ctx, rect);

      // 路线（虚线示意）
      ctx.lineWidth = 2 * k;
      ctx.strokeStyle = COLORS.routeLine;
      ctx.setLineDash([5 * k, 4 * k]);
      GUIDE_ROUTES.forEach((route) => {
        ctx.beginPath();
        route.pathPoints.forEach((p, i) => {
          const x = p[0] * k;
          const y = p[1] * k;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
      ctx.setLineDash([]);

      // 景点图标贴纸 + 标签
      GUIDE_POINTS.forEach((point) => {
        const x = point.x * k;
        const y = point.y * k;
        const isSelected = point.id === this.data.selectedId;
        const size = (isSelected ? ICON_SIZE + 6 : ICON_SIZE) * k;
        const half = size / 2;
        const img = this._pointImages[point.id];

        if (isSelected) {
          // 选中态：橄榄绿光晕
          ctx.beginPath();
          ctx.arc(x, y, half + 5 * k, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(98, 98, 71, 0.22)';
          ctx.fill();
        }
        if (img) {
          ctx.drawImage(img, x - half, y - half, size, size);
        } else {
          // 图标未就绪兜底：白色圆点
          const r = (isSelected ? 8 : 5.5) * k;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? COLORS.pointSelected : COLORS.pointFill;
          ctx.fill();
          ctx.lineWidth = 1.5 * k;
          ctx.strokeStyle = COLORS.pointEdge;
          ctx.stroke();
        }

        this._drawLabel(ctx, point, x, y, k, isSelected);
      });
    },

    _drawLabel(ctx, point, x, y, k, isSelected) {
      const fontSize = 14 * k;
      ctx.font = `${isSelected ? '600 ' : ''}${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let labelY = y;
      const lift = 24 * k; // 图标比圆点大，标签离点位更远一点
      if (point.labelSide === 'top' || (point.labelSide !== 'top' && point.y > 330)) {
        labelY = y - lift;
      } else {
        labelY = y + lift;
      }
      if (point.labelSide === 'left') {
        ctx.textAlign = 'right';
        ctx.fillText(point.title, x - 10 * k, labelY, 120 * k);
        return;
      }
      if (point.labelSide === 'right') {
        ctx.textAlign = 'left';
        ctx.fillText(point.title, x + 10 * k, labelY, 120 * k);
        return;
      }
      // 白色描边保证在海面/沙地上都可读
      ctx.lineWidth = 3 * k;
      ctx.strokeStyle = COLORS.labelHalo;
      ctx.strokeText(point.title, x, labelY, 140 * k);
      ctx.fillStyle = isSelected ? COLORS.pointSelected : COLORS.label;
      ctx.fillText(point.title, x, labelY, 140 * k);
    },

    onMapTap(e) {
      const touch = e.changedTouches && e.changedTouches[0];
      if (!touch) return;
      this.createSelectorQuery()
        .select('#islandCanvas')
        .boundingClientRect((rect) => {
          if (!rect) return;
          const vx = ((touch.clientX - rect.left) / rect.width) * VIEW_W;
          const vy = ((touch.clientY - rect.top) / rect.height) * VIEW_H;
          let best = null;
          let bestDist = Infinity;
          GUIDE_POINTS.forEach((point) => {
            const dx = vx - point.x;
            const dy = vy - point.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < TAP_RADIUS && dist < bestDist) {
              best = point;
              bestDist = dist;
            }
          });
          if (!best) return;
          this.triggerEvent('pointtap', {
            id: best.id,
            title: best.title,
            spotName: best.spotName,
            description: best.description,
          });
        })
        .exec();
    },
  },
});

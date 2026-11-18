#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
东澳岛 AI 检索式语料库构建脚本（离线、幂等）
==========================================

输入：东澳岛/data/ 下 5 份 xlsx（openpyxl read_only 只读，不修改原文件）
输出：
  1) 东澳岛/data/clean/*.csv                 —— 清洗后的中间表，供人工复核
  2) 东澳岛/data/corpus/_index.json          —— L2 片区语料 + L3 风格样本
     东澳岛/data/corpus/{map_name}.json      —— L1 点位档案（只放命中 52 点位的条目）
  3) 东澳岛/data/report/coverage.json/.md    —— 覆盖率、未匹配、quarantine、自检

运行（仓库根目录）：
    python scripts/build_dongao_corpus.py
    python scripts/build_dongao_corpus.py --dry-run   # 只清洗与校验，不写任何文件

字段契约：东澳岛/data/corpus/README.md
清洗规则：docs/东澳岛AI生成改造说明.md §3.3 / 附录 B
"""

import argparse
import csv
import datetime
import json
import re
import sys
import zipfile
from pathlib import Path

import openpyxl
from lxml import etree

try:  # Windows 控制台编码兜底，避免打印中文报错
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # pragma: no cover
    pass


# ===========================================================================
# 0. 路径与常量
# ===========================================================================

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "东澳岛" / "data"
CLEAN_DIR = DATA_DIR / "clean"
CORPUS_DIR = DATA_DIR / "corpus"
REPORT_DIR = DATA_DIR / "report"

AREAS_JSON = DATA_DIR / "area-map.json"
SPOTS_JS = ROOT / "cloudfunctions" / "initDongaoSpots" / "index.js"

SPOTS_XLSX = DATA_DIR / "东澳岛景点 字段采集(2).xlsx"
STAYS_XLSX = DATA_DIR / "东澳岛住宿字段采集.xlsx"
FOODS_XLSX = DATA_DIR / "东澳岛餐饮字段采集.xlsx"  # 2026-11-10 用户改名（旧名带全角句号+双扩展名）
SHOPS_XLSX = DATA_DIR / "东澳岛购物+文创字段采集表 更正版.xlsx"
KIDS_XLSX = DATA_DIR / "东澳岛亲子酒店字段收集（专门针对亲子客群.xlsx"
MENUS_DIR = DATA_DIR / "menus"  # 二期新增：菜单转写 JSON（另一位同事并行产出，可能不全）

VERSION = datetime.date.today().isoformat()
# 幂等：报告里不写运行时刻，只写构建日期（同一天重复运行，产物字节级一致）
GENERATED_AT = VERSION

# 来源短名（README 约定 source 形如「景点表#2」）
SRC_LABEL = {
    "spot": "景点表",
    "stay": "住宿表",
    "food": "餐饮表",
    "shop": "购物活动表",
    "activity": "购物活动表",
    "kids": "亲子表",
}

# 客群 8 种写法 → 4 个 id（§2.5；表内实际还混有「Z世代/情侣客群」等）
AUDIENCE_ALIASES = {
    "Z世代/情侣客群": "couple",
    "Z世代/情侣": "couple",
    "情侣客群": "couple",
    "情侣": "couple",
    "亲子客群": "family",
    "亲子": "family",
    "银发/休闲客群": "elder",
    "银发/休闲": "elder",
    "银发客群": "elder",
    "银发": "elder",
    "资深玩家/硬核探索客群": "hardcore",
    "资深玩家/硬核探索": "hardcore",
    "资深玩家": "hardcore",
}
AUDIENCE_IDS = ["couple", "family", "elder", "hardcore"]

# 缺失值口径（§2.5）：营业时间占位/未知视为缺失；「待实采确认」保留原文但不注入
MISSING_VALUES = {"", "未知", "营业时间未设置", "无", "暂无", "-", "/"}
OPEN_HOURS_MISSING = {"营业时间未设置", "未知"}

# 分隔符：先按「；」「、」拆，绝不按「/」拆（Z世代/情侣 本身含 /）
# 括号内的「、」不拆（如「东澳三宝（将军帽、狗爪螺、海胆）」）
OPEN_BRACKETS = "（("
CLOSE_BRACKETS = "）)"
TAG_SEPS = "、；;"

# 52 点位 → 片区：唯一权威，来自 东澳岛/data/area-map.json（脚本会校验，不修改它）
# 片区关键词规则：名称命中权重 2，地点/周边命中权重 1；同分取出现位置更早者
AREA_RULES = [
    (
        "nansha",
        [
            "南沙湾", "钻石银滩", "可域", "格力东澳大酒店", "格力大酒店", "格力酒店",
            "万豪", "大竹湾", "南沙咀", "夕阳驿站", "阿丽拉", "安麓", "长角路",
            "海盐餐厅", "海堂中餐厅", "醇酒吧", "保障性租赁住房", "海月巷", "绿岛路7号",
        ],
    ),
    (
        "miyue",
        [
            "蜜月", "婚礼堂", "森林栈道", "小竹湾", "观月", "观海亭", "斜行电梯",
            "教堂", "斧头丹峰",
        ],
    ),
    (
        "beian",
        [
            "铳城", "烽火台", "海关", "将军石林", "仙鹊桥", "灵犀台", "山海经书屋",
            "水手房", "映月滩", "开心石", "罗刀湾", "古驿道", "澳口", "听涛",
            "观海平台", "观景平台",
        ],
    ),
    (
        "nanya",
        ["揽海台", "飞鹰驿站", "叠石", "南侧海岸", "珊瑚礁"],
    ),
    (
        "fengche",
        [
            "风车山", "大王庙", "大王", "趣东澳", "摩崖石刻", "灯桩", "石景长廊",
            "街心公园", "海龙泉", "风荡石", "双豚出海", "万海平波", "东澳顶",
            "南村", "石景", "春栖山林", "望海山居",
        ],
    ),
    (
        "matou",
        [
            "码头", "渔村", "绿岛路", "绿道路", "绿路岛", "军民路", "一湾两岸",
            "万觅", "玲玎", "玲钉", "东澳湾", "海鲜市场", "村民委员会",
            "游客服务中心", "旅游度假区", "悦馨", "潮汐客栈", "海鲜街", "食街",
            "商业街",
        ],
    ),
]

# 点位名称别名（medium）：数据表名称 → map_name
# 二期新增：住宿/餐饮/购物表名称与 66 点位 map_name 对齐
SPOT_ALIASES = {
    "海洋科普馆": "万山海洋生物科普馆",
    "万觅": "万觅书店",
    "东澳海关遗址展览馆": "东澳岛海关遗址",
    "万觅书店（海上慢咖集）文创咖啡": "万觅书店",
    "山海经书屋文创": "山海经书屋",
    "东澳岛游客服务中心官方文创": "东澳岛游客服务中心",
}

# 分类错位 / 无法归属：直接进 quarantine，不生成 L1、不进 L2
QUARANTINE_BY_NAME = {
    "华发安麓酒店": "住宿类混入景点表（分类错位）；其住宿信息在住宿表/亲子表已有覆盖",
    "黛绿": "疑似线路/站点名，非独立景点；核心地点「待实采确认」，无法定位",
    "馨漫": "疑似线路/站点名，非独立景点；核心地点「待实采确认」，无法定位",
    "海钓点": "核心地点「待实采确认」，无法确定所属片区",
}

# 二期：菜单目录名 → map_name（含「已并入」的酒店/书屋）
MENU_SHOP_TO_POINT = {
    "万觅餐吧": "万觅餐吧",
    "东发海鲜酒家": "东发海鲜酒家",
    "是旦有愉食堂": "是旦有愉食堂",
    "是旦海鲜餐厅": "是旦海鲜餐厅",
    "潮汐咖啡": "潮汐咖啡",
    "精致拾光": "精致拾光",
    "聚鲜楼": "聚鲜楼",
    "山海经书屋": "山海经书屋",  # 已有点位，只作为该点菜单信息
    "格力东澳大酒店-蓝色海岸餐厅": "格力东澳大酒店",
    "珠海东澳岛安麓酒店-安心全日餐厅": "珠海东澳岛安麓酒店",
    "珠海东澳岛安麓酒店-安麓书院": "珠海东澳岛安麓酒店",
    "珠海东澳岛安麓酒店-麓中餐厅": "珠海东澳岛安麓酒店",
}

# 菜单不合并：高德查不到该点，或点位身份无法确认
MENU_NOT_INCLUDED = {
    "洒哥海鲜餐厅": "高德查不到该点位（不在点位库），菜单不合并",
    "摸鱼咖啡": "高德查不到该点位（不在点位库），菜单不合并",
    "东澳湾海鲜餐厅": "高德可查，但与采集表「海湾海鲜餐厅」是否同一家无法确认，用户决定两家都不入库、不进 L1",
    "海湾海鲜餐厅": "与「东澳湾海鲜餐厅」是否同一家无法确认，用户决定两家都不入库、不进 L1",
}

# L1 menu 选取上限（见任务 E）
# 本轮菜单范围：二期第一轮只接 8 家进库餐饮点；
# 酒店（格力/安麓）与山海经书屋菜单属下一轮增量，到齐后把这里扩成 ("food", "stay", "spot")
MENU_SCOPE_CATEGORIES = ("food",)
MAX_MENU_DISHES = 12
MAX_MENU_PACKAGES = 3
MENU_DISH_PRIORITY = ("招牌", "特色", "必点", "推荐")
MENU_NOISE = ("null", "详情", "咨询", "时价", "另计", "免费", "例份", "—", "-")
# 二期收敛规则（lead 2026-11-10）：酒水/餐具/主食等不算一道菜
MENU_DISH_BLACKLIST = (
    "酒", "啤酒", "小麦", "艾尔", "IPA", "果盘", "小吃篮", "纸巾", "茶位",
    "餐具", "米饭", "柠檬水", "可乐", "雪碧", "咖啡",
)
# 套餐黑名单：KTV/包房/免房费/包场/团建 不适合作为菜品套餐
MENU_PACKAGE_BLACKLIST = ("KTV", "包房", "免房费", "包场", "团建")
MENU_PACKAGE_BOOST = ("海鲜", "蒸", "炒", "套餐")
# 菜品 category 黑名单：酒水/饮品/咖啡/小吃等不算「一道菜」（菜单 JSON 有 category 时生效）
MENU_DISH_CATEGORY_BLACKLIST = ("酒", "饮品", "饮料", "鸡尾酒", "精酿", "咖啡", "茶", "小吃", "小食")

# 亲子转置表 4 家酒店 → 住宿表项目名（别名映射，避免误配）
KIDS_STAY_ALIASES = {
    "格力东澳大酒店": "格力东澳大酒店",
    "阿丽拉珠海东澳岛": "阿丽拉珠海东澳岛（ALILA）",
    "珠海东澳岛万豪": "珠海东澳岛万豪度假酒店",
    "安麓珠海东澳岛": "珠海东澳岛安麓酒店",
}

# 已知问题实体（不合并，只写进 coverage 供人工复核）
REVIEW_ALIASES = [
    ("观海长廊", "滨海栈道 / 听涛步道", "名称不在 52 点位内，疑似与现有步道重复，待人工确认"),
    ("聚鲜海鲜坊餐厅", "聚鲜海鲜餐厅", "同品牌、地址不同（格力/万豪附近 vs 旅游度假区东侧），台账疑似同一家，待实采"),
    ("梁记客栈（东澳岛店）", "邻海别苑（东澳岛店）", "住宿表原文：登记地址「绿岛路50号2栋2单元」与邻海别苑重复，需到店确认"),
    ("珠海东澳岛碧海星辰精品客栈", "珠海同心客栈", "住宿表原文：原一行合填两家，电话/价格归属待实采区分"),
    ("22度客栈（22°HOMESTAY）", "东澳岛与你同行民宿", "两店完全同址（绿岛路50号5栋4单元），需核实在营/同一物业"),
    ("倚山揽海路", "倚山揽海路（摆渡车路线）", "同一线路的景点口径与摆渡车口径，L2 玩法已按文本去重"),
]

# L3 风格样本兜底（docx 原文引语 + 三级标签里的画面短语，不编造；解析失败时才使用）
STYLE_FALLBACK = [
    "1314 米滑道的速度与激情",
    "山海间的书香约会",
    "南沙湾的日落承诺",
    "白色婚礼堂拍照",
    "海边看日落",
    "一起吹海风",
    "沙滩踏浪",
    "咖啡看海",
    "书店看海",
    "月牙环剪影",
    "森林栈道山海照",
    "风车山巅数星辰",
    "枕着海浪声入眠",
    "蓝眼泪夜间观赏",
    "缓缓上升的轿厢将蓝天白云碧海青山一同框入视野",
    "穿梭山林与碧海之间",
    "俯冲间将山海风光尽收眼底",
    "孩子有得玩、家长不操心",
    "不累、不赶、吃好",
]

DOCX_GLOB = "*.docx"
QUOTE_RE = re.compile(r"“([^”]{4,40})”")

# styleSamples 只收「有语气/有画面」的短句；标题、流程、需求定义句一律不收（README 第 63 行）
STYLE_JUNK_PATTERNS = (
    "AI", "→", "—", "模块", "标签", "流程", "要点", "开篇", "框架", "客群",
    "玩法", "四大", "攻略", "结构", "策略", "交付", "目标", "核心项目",
    "填充", "建议", "怎么", "如何", "为什么", "铁三角", "就去这了",
    "方法", "步骤", "任务", "分工", "素材", "机位", "构图", "穿搭",
    "标题", "封面", "字段", "采集", "验证信息", "资源点位", "活动", "取景地",
    "展区", "市场", "加工", "特产", "干货", "三宝", "买",
    "小红书", "笔记", "网红", "配套", "成熟", "研学", "知识点", "问答", "适龄",
    "讲解", "体系", "矩阵", "维度", "组合", "理由", "+", "慢游", "节律", "节奏",
)
PICTURE_KEYWORDS = (
    "海风", "海边", "海岸", "海景", "碧海", "海浪", "赶海", "看海", "吹海风",
    "海岛", "日落", "落日", "晚霞", "日出", "星空", "星辰", "银河", "蓝眼泪",
    "月色", "月牙", "沙滩", "踏浪", "剪影", "山海", "滨海", "书屋", "书店",
    "咖啡", "婚礼", "婚纱", "旅拍", "篝火", "夜色", "夜景", "漫步", "散步",
)
# playItems 只保留原子玩法；标题/流程类条目直接丢弃
PLAY_JUNK_PATTERNS = (
    "AI玩法", "客群标签", "需求标签", "玩法标签", "资源点位", "验证信息",
    "字段采集", "→",
)
PHONE_RE = re.compile(r"1[3-9]\d{9}|0\d{2,3}-?\d{7,8}")
MAX_PLAY_CHARS = 30
MAX_L1_CHARS = 600
MAX_INJECT_CHARS = 1200
MAX_AREA_PLAYS = 40

# 主档优先级：同一 map_name 多条来源时，景点表优先，其次住宿、餐饮、购物
KIND_PRIORITY = {"spot": 0, "stay": 1, "food": 2, "shop": 3, "activity": 4}

# 以下全局在 main() 里按输入动态填充（点位/分类/菜单都可能继续变化）
SPOT_META = {}
SPOT_CATEGORY = {}
MENUS_BY_POINT = {}
MENU_ROWS = []
MENU_WARNINGS = []


# ===========================================================================
# 1. 通用小工具
# ===========================================================================

def clean_cell(value):
    """单元格 → 干净字符串：None→空串、全角冒号转半角、去多余空白。"""
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = str(value).replace("\u3000", " ").strip()
    text = text.replace("：", ":")
    text = re.sub(r"[ \t\r\n]+", " ", text)
    return text


def pad_cells(cells, size):
    cells = list(cells)[:size]
    while len(cells) < size:
        cells.append("")
    return cells


def split_atoms(text):
    """拆三级标签/二级标签：按「、」「；」「;」拆，括号内不拆，绝不按「/」拆。"""
    text = clean_cell(text)
    if not text:
        return []
    out = []
    buf = []
    depth = 0
    for ch in text:
        if ch in OPEN_BRACKETS:
            depth += 1
            buf.append(ch)
        elif ch in CLOSE_BRACKETS:
            depth = max(0, depth - 1)
            buf.append(ch)
        elif ch in TAG_SEPS and depth == 0:
            atom = clean_cell("".join(buf))
            if atom and atom not in out:
                out.append(atom)
            buf = []
        else:
            buf.append(ch)
    atom = clean_cell("".join(buf))
    if atom and atom not in out:
        out.append(atom)
    return out


def split_clauses(text):
    """周边情况 → 短句数组（按「，」「；」拆，不拆顿号）。"""
    text = clean_cell(text)
    if not text:
        return []
    out = []
    for part in re.split(r"[，,；;]", text):
        part = clean_cell(part)
        if part and part not in out:
            out.append(part)
    return out


def normalize_audiences(raw):
    """一级标签 8 种写法 → couple/family/elder/hardcore。"""
    result = []
    for token in split_atoms(raw):
        key = token.replace(" ", "")
        aid = AUDIENCE_ALIASES.get(key)
        if aid is None:  # 兜底按关键词判断（如亲子表「亲子家庭（主题度假）」）
            if "情侣" in key:
                aid = "couple"
            elif "亲子" in key:
                aid = "family"
            elif "银发" in key or "休闲" in key:
                aid = "elder"
            elif "资深" in key or "硬核" in key:
                aid = "hardcore"
        if aid and aid not in result:
            result.append(aid)
    return result


def is_missing(text, missing_set=None):
    text = clean_cell(text)
    return text in (missing_set if missing_set is not None else MISSING_VALUES)


def source_ref(kind, row):
    return "%s#%s" % (SRC_LABEL[kind], row)


def load_sheet(path, sheet_name):
    """openpyxl read_only 读取整张表（返回 list[list[str]]，已 clean_cell）。"""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        ws = wb[sheet_name]
        rows = []
        for row in ws.iter_rows(values_only=True):
            rows.append([clean_cell(v) for v in row])
        return rows
    finally:
        wb.close()


def workbook_stats(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    stats = []
    try:
        for ws in wb.worksheets:
            rows = list(ws.iter_rows(values_only=True))
            non_empty = sum(1 for row in rows if any(clean_cell(v) for v in row))
            stats.append(
                {
                    "sheet": ws.title,
                    "maxRow": ws.max_row,
                    "maxColumn": ws.max_column,
                    "nonEmptyRows": non_empty,
                }
            )
    finally:
        wb.close()
    return stats


# ===========================================================================
# 2. 读取 5 份 xlsx（只读）
# ===========================================================================

def build_spot_entities():
    """景点表：Sheet1 有效，A 列合并分组（景点15/路线7/玩法7），表头第 1 行。"""
    rows = load_sheet(SPOTS_XLSX, "Sheet1")
    entities = []
    last_category = ""
    for excel_row, raw in enumerate(rows[1:], start=2):
        if excel_row > 30:
            break
        cells = pad_cells(raw, 12)
        name = cells[1]
        if not name:
            continue
        category = cells[0] or last_category  # 合并单元格 forward-fill
        last_category = category
        raw_map = {
            "类别": category,
            "项目": name,
            "一级标签": cells[2],
            "二级标签": cells[3],
            "三级标签": cells[4],
            "核心地点": cells[5],
            "周边情况": cells[6],
            "最佳时段": cells[7],
            "游玩时长": cells[8],
            "预算区间": cells[9],
            "适配人数": cells[10],
            "预订方式": cells[11],
        }
        entities.append(
            {
                "kind": "spot",
                "source_file": SPOTS_XLSX.name,
                "source_sheet": "Sheet1",
                "source_row": excel_row,
                "source": source_ref("spot", excel_row),
                "category": category,
                "name": name,
                "audience_raw": cells[2],
                "audiences": normalize_audiences(cells[2]),
                "needs": split_atoms(cells[3]),
                "plays": split_atoms(cells[4]),
                "location": cells[5],
                "surroundings": split_clauses(cells[6]),
                "best_time": cells[7],
                "duration": cells[8],
                "budget": cells[9],
                "party_size": cells[10],
                "booking": cells[11],
                "verified": "待实采",  # 景点表无实采状态列，按 §2.2 默认
                "open_hours": "",
                "avg_price": "",
                "orig_seq": "",
                "raw": raw_map,
                "area_id": "",
                "area_name": "",
                "is_route": False,
                "traversal_areas": [],
                "quarantine": False,
                "quarantine_reason": "",
                "duplicate_of": "",
                "kids_note": "",
            }
        )
    return entities


def build_stay_entities():
    """住宿表：住宿字段采集表，29 行，表头第 1 行。"""
    rows = load_sheet(STAYS_XLSX, "住宿字段采集表")
    entities = []
    for excel_row, raw in enumerate(rows[1:], start=2):
        if excel_row > 30:
            break
        cells = pad_cells(raw, 16)
        name = cells[2]
        if not name:
            continue
        verified = "已验证" if cells[14] == "已验证" else "待实采"
        raw_map = {
            "序号": cells[0],
            "类别": cells[1],
            "项目": name,
            "一级标签": cells[3],
            "二级标签": cells[4],
            "三级标签": cells[5],
            "核心地点": cells[6],
            "周边情况": cells[7],
            "最佳时段": cells[8],
            "游玩时长（建议入住）": cells[9],
            "预算区间（房价/晚）": cells[10],
            "适配人数": cells[11],
            "预订方式": cells[12],
            "实采待检验项": cells[13],
            "实采观察备注": cells[14],
        }
        entities.append(
            {
                "kind": "stay",
                "source_file": STAYS_XLSX.name,
                "source_sheet": "住宿字段采集表",
                "source_row": excel_row,
                "source": source_ref("stay", excel_row),
                "category": cells[1],
                "name": name,
                "audience_raw": cells[3],
                "audiences": normalize_audiences(cells[3]),
                "needs": split_atoms(cells[4]),
                "plays": split_atoms(cells[5]),
                "location": cells[6],
                "surroundings": split_clauses(cells[7]),
                "best_time": cells[8],
                "duration": cells[9],
                "budget": cells[10],
                "party_size": cells[11],
                "booking": cells[12],
                "verified": verified,
                "open_hours": "",
                "avg_price": "",
                "orig_seq": cells[0],
                "raw": raw_map,
                "area_id": "",
                "area_name": "",
                "is_route": False,
                "traversal_areas": [],
                "quarantine": False,
                "quarantine_reason": "",
                "duplicate_of": "",
                "kids_note": "",
            }
        )
    return entities


def build_food_entities():
    """餐饮表：字段采集模板，38 行；一级/二级/三级标签用全角「；」分隔。"""
    rows = load_sheet(FOODS_XLSX, "字段采集模板")
    entities = []
    for excel_row, raw in enumerate(rows[1:], start=2):
        if excel_row > 39:
            break
        cells = pad_cells(raw, 12)
        name = cells[2]
        if not name:
            continue
        open_hours = "" if cells[8] in OPEN_HOURS_MISSING else cells[8]
        raw_map = {
            "类别": cells[0],
            "序号": cells[1],
            "餐厅名称": name,
            "一级标签": cells[3],
            "二级标签": cells[4],
            "三级标签": cells[5],
            "位置": cells[6],
            "周边情况": cells[7],
            "营业时间": cells[8],
            "人均消费": cells[9],
            "预订方式": cells[10],
            "实采检验项": cells[11],
        }
        entities.append(
            {
                "kind": "food",
                "source_file": FOODS_XLSX.name,
                "source_sheet": "字段采集模板",
                "source_row": excel_row,
                "source": source_ref("food", excel_row),
                "category": cells[0],
                "name": name,
                "audience_raw": cells[3],
                "audiences": normalize_audiences(cells[3]),
                "needs": split_atoms(cells[4]),
                "plays": split_atoms(cells[5]),
                "location": cells[6],
                "surroundings": split_clauses(cells[7]),
                "best_time": "",
                "duration": "",
                "budget": "",
                "party_size": "",
                "booking": cells[10],
                "verified": "",
                "open_hours": open_hours,
                "avg_price": cells[9],
                "orig_seq": cells[1],
                "raw": raw_map,
                "area_id": "",
                "area_name": "",
                "is_route": False,
                "traversal_areas": [],
                "quarantine": False,
                "quarantine_reason": "",
                "duplicate_of": "",
                "kids_note": "",
            }
        )
    return entities


def build_shop_entities():
    """购物+活动表：表头在第 2 行，有效数据到第 44 行，15–22 列为空列应丢弃；
    序号在活动段重置，需重建全局序号。"""
    rows = load_sheet(SHOPS_XLSX, "Sheet1")
    entities = []
    last_category = ""
    global_seq = 0
    for excel_row, raw in enumerate(rows[2:44], start=3):  # 第 3–44 行
        cells = pad_cells(raw, 14)  # 只用有效 14 列
        name = cells[2]
        if not name:
            continue
        category = cells[0] or last_category  # A 列合并单元格 forward-fill
        last_category = category
        global_seq += 1
        kind = "activity" if category == "活动" else "shop"
        raw_map = {
            "类别": category,
            "序号（原表）": cells[1],
            "项目": name,
            "一级标签": cells[3],
            "二级标签": cells[4],
            "三级标签": cells[5],
            "核心地点": cells[6],
            "周边情况": cells[7],
            "最佳时段": cells[8],
            "游玩时长": cells[9],
            "预算区间": cells[10],
            "适配人数": cells[11],
            "预订方式": cells[12],
            "已检验项": cells[13],
        }
        entities.append(
            {
                "kind": kind,
                "source_file": SHOPS_XLSX.name,
                "source_sheet": "Sheet1",
                "source_row": excel_row,
                "source": source_ref(kind, excel_row),
                "category": category,
                "name": name,
                "audience_raw": cells[3],
                "audiences": normalize_audiences(cells[3]),
                "needs": split_atoms(cells[4]),
                "plays": split_atoms(cells[5]),
                "location": cells[6],
                "surroundings": split_clauses(cells[7]),
                "best_time": cells[8],
                "duration": cells[9],
                "budget": cells[10],
                "party_size": cells[11],
                "booking": cells[12],
                "verified": "",
                "open_hours": "",
                "avg_price": "",
                "orig_seq": cells[1],
                "global_seq": global_seq,
                "checked_note": cells[13],
                "raw": raw_map,
                "area_id": "",
                "area_name": "",
                "is_route": False,
                "traversal_areas": [],
                "quarantine": False,
                "quarantine_reason": "",
                "duplicate_of": "",
                "kids_note": "",
            }
        )
    return entities


def build_kids_hotels():
    """亲子表：转置表（字段为行、4 家酒店为列），转置后按酒店名合并进住宿。"""
    rows = load_sheet(KIDS_XLSX, "Sheet1")
    header = pad_cells(rows[0], 5)
    hotels = header[1:5]
    fields = {}
    for raw in rows[1:12]:
        cells = pad_cells(raw, 5)
        if cells[0]:
            fields[cells[0]] = cells[1:5]
    result = []
    for idx, hotel in enumerate(hotels):
        if not hotel:
            continue
        item = {"name": hotel, "source_file": KIDS_XLSX.name,
                "source_sheet": "Sheet1", "source_col": chr(ord("B") + idx)}
        for field, values in fields.items():
            item[field] = values[idx] if idx < len(values) else ""
        result.append(item)
    return result


# ===========================================================================
# 3. 片区判断
# ===========================================================================

def score_areas(name, body):
    """返回 {area_id: (score, first_pos)}；名称命中记 2 分，地点/周边命中记 1 分。"""
    scores = {}
    for area_id, keywords in AREA_RULES:
        score = 0
        first_pos = None
        for kw in keywords:
            pos_name = name.find(kw)
            pos_body = body.find(kw)
            if pos_name >= 0:
                score += 2
                pos = pos_name
            elif pos_body >= 0:
                score += 1
                pos = 1000 + pos_body
            else:
                continue
            if first_pos is None or pos < first_pos:
                first_pos = pos
        if score:
            scores[area_id] = (score, first_pos)
    return scores


def detect_area(name, body):
    """按 名称 → 地点/周边 打分，返回 area_id（无法判断返回空串）。"""
    scores = score_areas(clean_cell(name), clean_cell(body))
    if not scores:
        return ""
    order_index = {cfg["id"]: i for i, cfg in enumerate(AREA_CONFIG)}
    best = max(
        scores.items(),
        key=lambda item: (item[1][0], -item[1][1], -order_index.get(item[0], 99)),
    )
    return best[0]


def detect_area_ids(text):
    """路线用：文本里命中的所有片区（按 area-map 顺序返回）。"""
    text = clean_cell(text)
    found = []
    for cfg in AREA_CONFIG:
        for area_id, keywords in AREA_RULES:
            if area_id != cfg["id"]:
                continue
            if any(kw in text for kw in keywords):
                found.append(area_id)
                break
    return found


# ===========================================================================
# 4. 52 点位映射
# ===========================================================================

def load_spot_meta():
    """解析 initDongaoSpots 的 SPOTS_DATA（动态数量，当前 66 条）。
    返回按文件顺序的 [{map_name, amap_name, coords, category}]。"""
    text = SPOTS_JS.read_text(encoding="utf-8")
    block_match = re.search(r"SPOTS_DATA\s*=\s*\[(.*?)\];", text, re.S)
    if not block_match:
        raise SystemExit("initDongaoSpots 中找不到 SPOTS_DATA 数组")
    meta = []
    for obj in re.findall(r"\{[^{}]*\}", block_match.group(1)):
        if "map_name" not in obj:
            continue
        fields = dict(re.findall(r'"(\w+)"\s*:\s*"([^"]*)"', obj))
        if "map_name" not in fields:
            continue
        meta.append(
            {
                "map_name": clean_cell(fields["map_name"]),
                "amap_name": clean_cell(fields.get("amap_name", "")),
                "coords": clean_cell(fields.get("coords", "")),
                "category": clean_cell(fields.get("category", "")),
            }
        )
    if not meta:
        raise SystemExit("initDongaoSpots 中 SPOTS_DATA 解析为空，请检查格式")
    return meta


def load_map_names():
    """点位列表从 SPOTS_DATA 动态解析（不再硬编码 52）。"""
    meta = load_spot_meta()
    names = [item["map_name"] for item in meta]
    if len(names) != len(set(names)):
        raise SystemExit("initDongaoSpots 中 map_name 存在重复：%d 条" % len(names))
    return names


def load_area_map():
    data = json.loads(AREAS_JSON.read_text(encoding="utf-8"))
    return data


def strip_type_suffix(name):
    """去掉「（博物馆类）」「（研学线路类）」这类类型后缀。"""
    return re.sub(r"（[^）]*类）$", "", name).strip()


def strip_ascii_suffix(name):
    """去掉尾部纯英文/数字括号后缀（如「阿丽拉珠海东澳岛（ALILA）」）。
    只匹配 ASCII 内容，不会误伤「（博物馆类）」。"""
    return re.sub(r"（[A-Za-z0-9 .\-]+）$", "", name).strip()


def map_spot_name(name):
    """数据表名称 → 点位 map_name（动态 66 点位）。返回 (mapName, confidence, matchedBy) 或 None。"""
    raw = clean_cell(name)
    if not raw:
        return None
    variants = []
    for candidate in (
        raw,
        strip_type_suffix(raw),
        strip_ascii_suffix(raw),
        strip_ascii_suffix(strip_type_suffix(raw)),
        strip_type_suffix(strip_ascii_suffix(raw)),
    ):
        if candidate and candidate not in variants:
            variants.append(candidate)
    for candidate in variants:
        if candidate in MAP_NAMES:
            if candidate == raw:
                return candidate, "high", "exact"
            return candidate, "medium", "alias:normalize"
    for candidate in variants:
        if candidate in SPOT_ALIASES:
            return SPOT_ALIASES[candidate], "medium", "alias"
    return None


# ---------------------------------------------------------------------------
# 4.1 菜单语料（二期新增输入：东澳岛/data/menus/*.json）
# ---------------------------------------------------------------------------

def number_out(value):
    """把数字统一成 int/float，便于 menu JSON 输出。"""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return int(value) if float(value).is_integer() else round(float(value), 2)
    return value


def menu_price(value):
    """菜单价格 → (数字或 None, 原值)。时价/咨询/null 返回 None。"""
    if isinstance(value, bool):
        return None, value
    if isinstance(value, (int, float)):
        return float(value), value
    text = clean_cell(value)
    if not text or text.lower() in ("null", "none", "undefined"):
        return None, value
    if any(noise in text for noise in ("时价", "咨询", "详情", "另计", "免费")):
        return None, value
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)", text)
    if match:
        return float(match.group(1)), value
    return None, value


def menu_dish_ok(name):
    name = clean_cell(name)
    if not name or len(name) < 2 or len(name) > 20:
        return False
    if name.lower() in ("null", "none", "undefined"):
        return False
    if any(noise in name for noise in MENU_NOISE):
        return False
    # 酒水/餐具/主食等不算「一道菜」；套餐 items 里也统一剔除
    return not any(keyword in name for keyword in MENU_DISH_BLACKLIST)


def menu_dish_priority(name):
    return 2 if any(tag in name for tag in MENU_DISH_PRIORITY) else 0


def menu_category_ok(category):
    category = clean_cell(category)
    return not any(keyword in category for keyword in MENU_DISH_CATEGORY_BLACKLIST)


def resolve_menu_target(shop_key):
    """菜单 shop/目录名 → (point, status, note)。status: included/excluded/unknown。"""
    key = clean_cell(shop_key)
    if not key:
        return "", "unknown", ""
    if key in MENU_SHOP_TO_POINT:
        return MENU_SHOP_TO_POINT[key], "included", "exact"
    if key in MENU_NOT_INCLUDED:
        return "", "excluded", MENU_NOT_INCLUDED[key]
    best = None
    for source, target in MENU_SHOP_TO_POINT.items():
        if source in key or key in source:
            if best is None or len(source) > len(best[0]):
                best = (source, target)
    if best:
        return best[1], "included", "contains:%s" % best[0]
    for source, reason in MENU_NOT_INCLUDED.items():
        if source in key or key in source:
            return "", "excluded", reason
    return "", "unknown", ""


def count_menu_uncertain(data):
    """菜单里价格缺失/不可解析的条目数（人工复核用）。"""
    count = 0
    for dish in data.get("dishes") or []:
        if menu_price(dish.get("price"))[0] is None:
            count += 1
    for package in data.get("packages") or []:
        for group in package.get("groups") or []:
            for item in group.get("items") or []:
                if menu_price(item.get("unitPrice"))[0] is None:
                    count += 1
    return count


def tier_sample(candidates, slots):
    """价格分档采样：价格升序切 3 段（低/中/高），每段按原顺序取若干条，凑满 slots。"""
    if slots <= 0 or not candidates:
        return []
    by_price = sorted(candidates, key=lambda c: (c[1], c[2]))
    total = len(by_price)
    chunk = (total + 2) // 3
    segments = [by_price[:chunk], by_price[chunk:2 * chunk], by_price[2 * chunk:]]
    base = slots // 3
    counts = [base, base, base]
    for index in range(slots - sum(counts)):
        counts[index % 3] += 1
    picked = []
    picked_names = set()
    for segment, count in zip(segments, counts):
        for candidate in sorted(segment, key=lambda c: c[2])[:count]:
            if candidate[3] in picked_names:
                continue
            picked.append(candidate)
            picked_names.add(candidate[3])
    # 某段候选不够时，用剩余候选按原顺序补齐
    if len(picked) < slots:
        for candidate in sorted(candidates, key=lambda c: c[2]):
            if candidate[3] in picked_names:
                continue
            picked.append(candidate)
            picked_names.add(candidate[3])
            if len(picked) >= slots:
                break
    return picked


def collect_menu_dishes(entries, packages=None):
    """挑最多 MAX_MENU_DISHES 道菜：
    1) 名称含「招牌/特色/必点/推荐」最优先；
    2) 价格缺失（null，多为套餐内容）单独优先保留；
    3) 其余按价格升序分低/中/高三段，每段按原顺序取样，凑满 12 条；
    4) 只有套餐页（无单点价）时，从筛选后的 packages[].items 回填菜名。"""
    candidates = []
    order = 0
    for entry in entries:
        data = entry["data"]
        has_dishes = bool(data.get("dishes"))
        for dish in data.get("dishes") or []:
            name = clean_cell(dish.get("name"))
            if not menu_dish_ok(name):
                continue
            if not menu_category_ok(dish.get("category", "")):
                continue
            price_num, _ = menu_price(dish.get("price"))
            price_out = number_out(price_num) if price_num is not None else None
            candidates.append(
                (
                    menu_dish_priority(name),
                    price_num,
                    order,
                    name,
                    price_out,
                    clean_cell(dish.get("unit", "")),
                )
            )
            order += 1
        if has_dishes:
            continue  # 该菜单文件已有 dishes 列表时，不再从套餐 items 反推菜品，避免重名/重价
        for package in data.get("packages") or []:
            for group in package.get("groups") or []:
                for item in group.get("items") or []:
                    name = clean_cell(item.get("name"))
                    if not menu_dish_ok(name):
                        continue
                    # 套餐里的多份/整箱 item（qty 如「30瓶」「4份」）不是单点菜，价格也不是单点价
                    qty = clean_cell(item.get("qty", ""))
                    qty_match = re.search(r"([0-9]+)", qty)
                    if qty_match and int(qty_match.group(1)) > 1:
                        continue
                    price_num, _ = menu_price(item.get("unitPrice"))
                    if price_num is None:
                        continue
                    candidates.append(
                        (menu_dish_priority(name), price_num, order, name, number_out(price_num), "")
                    )
                    order += 1

    # 同名去重：保留优先级更高的一条（同优先级保留先出现）
    dedup = {}
    for candidate in candidates:
        name = candidate[3]
        if name not in dedup or candidate[0] > dedup[name][0]:
            dedup[name] = candidate
    all_candidates = list(dedup.values())

    priority_group = sorted([c for c in all_candidates if c[0] > 0], key=lambda c: c[2])
    null_group = sorted(
        [c for c in all_candidates if c[0] == 0 and c[1] is None], key=lambda c: c[2]
    )
    priced_group = [c for c in all_candidates if c[0] == 0 and c[1] is not None]

    selected = priority_group[:MAX_MENU_DISHES]
    selected.extend(null_group[: MAX_MENU_DISHES - len(selected)])
    selected.extend(tier_sample(priced_group, MAX_MENU_DISHES - len(selected)))

    # 同义重复（谁包含谁）只留第一次出现的一条
    dishes = []
    kept_names = []
    for _, price_num, _, name, price_out, unit in selected:
        if any(name != kept and (name in kept or kept in name) for kept in kept_names):
            continue
        kept_names.append(name)
        if price_num is None:
            dishes.append({"name": name, "price": None, "unit": ""})
            continue
        item = {"name": name, "price": price_out}
        if unit:
            item["unit"] = unit
        dishes.append(item)
        if len(dishes) >= MAX_MENU_DISHES:
            break

    if dishes:
        return dishes
    # 只有套餐页（无单点价）时：用筛选后的套餐 items 回填菜名，保证 prompt 有菜可推荐
    backfill = []
    for package in packages or []:
        for item_name in package.get("items", []):
            if item_name in backfill:
                continue
            backfill.append(item_name)
            if len(backfill) >= MAX_MENU_DISHES:
                break
        if len(backfill) >= MAX_MENU_DISHES:
            break
    return [{"name": name, "price": None, "unit": ""} for name in backfill]


def collect_menu_packages(entries):
    """套餐：剔除 KTV/包房/免房费/包场/团建 与空名；items 带海鲜/蒸/炒/套餐 的优先。"""
    candidates = []
    order = 0
    for entry in entries:
        for package in entry["data"].get("packages") or []:
            name = clean_cell(package.get("name"))
            if len(name) < 2 or name in ("?", "？", "null", "None"):
                continue
            if any(keyword in name for keyword in MENU_PACKAGE_BLACKLIST):
                continue
            items = []
            for group in package.get("groups") or []:
                for item in group.get("items") or []:
                    item_name = clean_cell(item.get("name"))
                    if menu_dish_ok(item_name) and item_name not in items:
                        items.append(item_name)
            if not items:
                continue
            text = "、".join(items)
            boost = sum(1 for keyword in MENU_PACKAGE_BOOST if keyword in text)
            price_num, raw_price = menu_price(package.get("price"))
            candidates.append(
                (
                    boost,
                    order,
                    {
                        "name": name,
                        "price": number_out(price_num) if price_num is not None else raw_price,
                        "items": items[:20],
                    },
                )
            )
            order += 1
    candidates.sort(key=lambda item: (-item[0], item[1]))
    return [item for _, _, item in candidates[:MAX_MENU_PACKAGES]]


def build_menu_payload(point, menus_by_point):
    """L1 menu 字段：dishes ≤12、packages ≤3、source 指向原始菜单目录。"""
    bucket = menus_by_point.get(point)
    if not bucket or not bucket.get("entries"):
        return None
    entries = bucket["entries"]
    packages = collect_menu_packages(entries)
    dishes = collect_menu_dishes(entries, packages)
    source_dirs = []
    for entry in entries:
        if entry["dir"] and entry["dir"] not in source_dirs:
            source_dirs.append(entry["dir"])
    if source_dirs:
        # 可追溯：单目录为「餐厅菜单/目录名」，多目录用「、」并列
        source = "餐厅菜单/" + "、".join(source_dirs)
    else:
        source = "餐厅菜单"
    if not dishes and not packages:
        return None
    return {"dishes": dishes, "packages": packages, "source": source}


def load_menus():
    """读取东澳岛/data/menus/*.json（允许尚未落盘或部分缺失）。
    返回 (menu_rows, menus_by_point, warnings)。"""
    menu_rows = []
    menus_by_point = {}
    warnings = []
    if not MENUS_DIR.exists():
        return menu_rows, menus_by_point, ["menus 目录不存在（菜单转写尚未落盘）"]
    files = sorted(MENUS_DIR.rglob("*.json"))
    for path in files:
        rel = path.relative_to(DATA_DIR).as_posix()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            warnings.append("%s 解析失败：%s" % (rel, exc))
            continue
        if not isinstance(data, dict):
            warnings.append("%s 不是 JSON 对象，已跳过" % rel)
            continue
        shop = clean_cell(data.get("shop") or path.stem)
        candidates = [shop, path.stem]
        if path.parent != MENUS_DIR:
            candidates.append(path.parent.name)
        target, status, note = "", "unknown", ""
        for candidate in candidates:
            target, status, note = resolve_menu_target(candidate)
            if status != "unknown":
                break
        source_dir = path.parent.name if path.parent != MENUS_DIR else path.stem
        if status == "excluded":
            continue  # 未纳入点位（洒哥/摸鱼）：报告静态清单已说明，不进 menus.csv
        if status == "unknown":
            warnings.append("%s：菜单 shop「%s」无法映射到 %d 个点位，已跳过" % (rel, shop, len(MAP_NAMES)))
            continue
        # 本轮范围内的点位才进 menus.csv / L1；酒店/书屋菜单等下一轮再纳入
        target_category = SPOT_CATEGORY.get(target, "")
        in_scope = (
            target_category in MENU_SCOPE_CATEGORIES
            if target_category
            else ("spot" in MENU_SCOPE_CATEGORIES)
        )
        if not in_scope:
            continue
        menu_rows.append(
            {
                "shop": shop,
                "map_name": target,
                "kind": clean_cell(data.get("kind", "")),
                "packages": len(data.get("packages") or []),
                "dishes": len(data.get("dishes") or []),
                "uncertain": count_menu_uncertain(data),
                "source_files": rel,
                "_status": status,
                "_note": note,
                "_dir": source_dir,
                "_file": rel,
            }
        )
        bucket = menus_by_point.setdefault(target, {"entries": []})
        bucket["entries"].append({"dir": source_dir, "data": data, "file": rel})
    return menu_rows, menus_by_point, warnings


# ===========================================================================
# 5. 实体整理：片区、quarantine、重复
# ===========================================================================

def prepare_entities():
    spot_entities = build_spot_entities()
    stay_entities = build_stay_entities()
    food_entities = build_food_entities()
    shop_entities = build_shop_entities()
    kids_hotels = build_kids_hotels()
    all_entities = spot_entities + stay_entities + food_entities + shop_entities

    area_name = {cfg["id"]: cfg["name"] for cfg in AREA_CONFIG}

    for entity in all_entities:
        text = " ".join([entity.get("location", ""), " ".join(entity.get("surroundings", []))])

        # 路线/线路：玩法可跨片区（摆渡车、徒步线）
        if entity["kind"] == "spot":
            entity["is_route"] = (
                "路线" in entity["category"]
                or "线路" in entity["category"]
                or "路线" in entity["name"]
                or "线路" in entity["name"]
            )

        # quarantine（§2.5 分类错位 / 无法判断）
        reason = QUARANTINE_BY_NAME.get(entity["name"])
        if reason is None and entity["kind"] == "spot" and "酒店" in entity["name"]:
            reason = "住宿类混入景点表（分类错位）"
        if reason is None and entity["name"] == "海钓点" and "待实采确认" in entity["location"]:
            reason = "核心地点「待实采确认」，无法确定所属片区"
        if reason:
            entity["quarantine"] = True
            entity["quarantine_reason"] = reason
            continue

        # 点位名匹配：二期对 spot/stay/food/shop 全部生效（新增点位靠 map_name 进片区）
        matched = map_spot_name(entity["name"])
        if matched:
            entity["map_name"], entity["map_confidence"], entity["matched_by"] = matched
        else:
            entity["map_name"], entity["map_confidence"], entity["matched_by"] = "", "", ""

        if entity["is_route"]:
            # 路线只按「名称 + 核心地点 + 周边情况」判断途经片区，
            # 不把三级玩法文本算进去（否则「森林栈道山海照」这类玩法会把路线误挂到蜜月山）
            full_text = entity["name"] + " " + text
            entity["traversal_areas"] = detect_area_ids(full_text)
            area_id = detect_area(entity["name"], text)
            if not area_id and entity["traversal_areas"]:
                area_id = entity["traversal_areas"][0]
            entity["area_id"] = area_id
        else:
            entity["area_id"] = detect_area(entity["name"], text)

        # 命中点位 → 片区以 东澳岛/data/area-map.json 的 spotToArea 为唯一权威
        if entity["map_name"]:
            area_id = SPOT_TO_AREA.get(entity["map_name"], "")
            if area_id:
                entity["area_id"] = area_id

        if not entity["area_id"]:
            entity["quarantine"] = True
            entity["quarantine_reason"] = "名称/地址无法判断所属片区（不硬挂 L2）"
            continue
        entity["area_name"] = area_name.get(entity["area_id"], "")

    # 餐饮重复 1：#19 渔海鲜餐厅 与 #36 渔·日落海景餐厅 同址（绿岛路7号）
    food_by_row = {e["source_row"]: e for e in food_entities}
    if 19 in food_by_row and 36 in food_by_row:
        dup = food_by_row[19]
        keep = food_by_row[36]
        dup["duplicate_of"] = keep["name"]
        keep["merged_duplicates"] = [dup["source"]]

    # 餐饮重复 2（二期）：海湾海鲜餐厅 / 东澳湾海鲜餐厅 身份无法确认，
    # 用户 2026-11-11 决定两家都不进点位库、不合并菜单（见 MENU_NOT_INCLUDED）。

    # 亲子表 → 住宿表（只取亲子标签与设施，写进 stay 的 kids_note）
    stay_by_name = {e["name"]: e for e in stay_entities}
    kids_merge = []
    for kids in kids_hotels:
        target_name = KIDS_STAY_ALIASES.get(kids["name"], kids["name"])
        target = stay_by_name.get(target_name)
        if not target:
            kids["matched_stay"] = ""
            kids_merge.append({"kids": kids["name"], "stay": "", "ok": False})
            continue
        label = kids.get("一级标签", "")
        theme_match = re.search(r"（([^）]+)）", label)
        theme = theme_match.group(1) if theme_match else ""
        kids_tag = "亲子友好·" + theme if theme else "亲子友好"
        target["kids_note"] = kids_tag
        target["kids_tag"] = label
        kids["matched_stay"] = target["source"]
        kids_merge.append({"kids": kids["name"], "stay": target["source"], "ok": True})

    return {
        "spots": spot_entities,
        "stays": stay_entities,
        "foods": food_entities,
        "shops": [e for e in shop_entities if e["kind"] == "shop"],
        "activities": [e for e in shop_entities if e["kind"] == "activity"],
        "kids": kids_hotels,
        "all": all_entities,
        "kids_merge": kids_merge,
    }


# ===========================================================================
# 6. L1 点位档案
# ===========================================================================

FIELD_KEYS = [
    ("bestTime", "best_time"),
    ("duration", "duration"),
    ("budget", "budget"),
    ("partySize", "party_size"),
    ("booking", "booking"),
    ("location", "location"),
]


def entity_score(entity):
    """资料完整度：字段非空且不是「待实采确认」计 1 分。"""
    score = 0
    for _, key in FIELD_KEYS:
        value = entity.get(key, "")
        if value and value not in ("待实采确认", "待实采"):
            score += 1
    score += 1 if entity.get("plays") else 0
    score += 1 if entity.get("surroundings") else 0
    return score


def build_l1_archives(entities):
    """为全部点位（动态 66）建 L1：景点/住宿/餐饮/购物按 map_name 分组，主档优先景点表；
    玩法/客群/需求取并集；餐饮附 openHours/avgPrice，有菜单的点位附 menu（二期）。"""
    grouped = {}
    for kind, plural in (
        ("spot", "spots"),
        ("stay", "stays"),
        ("food", "foods"),
        ("shop", "shops"),
    ):
        for entity in entities[plural]:
            if entity["quarantine"] or not entity.get("map_name"):
                continue
            map_name = entity["map_name"]
            group = grouped.setdefault(
                map_name,
                {
                    "rows": [],
                    "confidence": "high",
                    "matchedBy": entity["matched_by"],
                    "hasExact": False,
                    "hasAlias": False,
                    "aliases": [],
                },
            )
            group["rows"].append(entity)
            if entity["matched_by"] == "exact":
                group["hasExact"] = True
            else:
                group["hasAlias"] = True
                group["confidence"] = "medium"
                if entity["name"] != map_name:
                    alias_label = "%s(%s)" % (entity["name"], entity["source"])
                    if alias_label not in group["aliases"]:
                        group["aliases"].append(alias_label)

    l1_map = {}
    l1_report = []
    for map_name, group in grouped.items():
        rows = group["rows"]
        # 主档：非重复行 > 资料完整度 > 景点/住宿/餐饮/购物优先级 > 行号
        primary = min(
            rows,
            key=lambda e: (
                1 if e.get("duplicate_of") else 0,
                -entity_score(e),
                KIND_PRIORITY.get(e["kind"], 9),
                e["source_row"],
            ),
        )
        ordered = [primary] + [e for e in rows if e is not primary]
        duplicate_sources = [e["source"] for e in rows if e.get("duplicate_of")]

        audiences, needs, plays = [], [], []

        def merge(entity):
            for aid in entity.get("audiences", []):
                if aid not in audiences:
                    audiences.append(aid)
            for need in entity.get("needs", []):
                if need not in needs:
                    needs.append(need)
            for play in entity.get("plays", []):
                if play not in plays:
                    plays.append(play)

        for entity in ordered:
            merge(entity)

        plays = [play for play in plays if not is_junk_play(play)][:8]  # README：plays 1–8 条
        if not plays:
            plays = [play for play in split_atoms(primary["raw"].get("三级标签", ""))
                     if not is_junk_play(play)][:8]
        if not audiences:
            raise SystemExit("L1 缺少 audiences：%s" % map_name)

        raw = dict(primary["raw"])
        merged_sources = [e["source"] for e in ordered[1:]]
        if merged_sources:
            raw["合并来源"] = "、".join(merged_sources)

        archive = {
            "mapName": map_name,
            "version": VERSION,
            "source": {
                "file": primary["source_file"],
                "sheet": primary["source_sheet"],
                "row": primary["source_row"],
                "verified": primary.get("verified") or "待实采",
            },
            "audiences": audiences,
            "plays": plays,
        }
        # 二期字段：category（只给新增 13 个点位；52 个景点省略）
        category = SPOT_CATEGORY.get(map_name, "")
        if category:
            archive["category"] = category
        for out_key, in_key in FIELD_KEYS:
            value = primary.get(in_key, "")
            if value:
                archive[out_key] = value
        # 二期字段：餐饮营业时间/人均原文（组内有餐饮来源就取该来源）
        food_members = [e for e in ordered if e["kind"] == "food"]
        if food_members:
            food_member = food_members[0]
            if food_member.get("open_hours"):
                archive["openHours"] = food_member["open_hours"]
            if food_member.get("avg_price"):
                archive["avgPrice"] = food_member["avg_price"]
        if primary.get("surroundings"):
            archive["surroundings"] = primary["surroundings"][:5]
        if needs:
            archive["needs"] = needs[:8]
        # 二期：住宿点位置保留亲子标签（来自亲子转置表，仅 4 家酒店有）
        if category == "stay" and primary.get("kids_note"):
            archive["kidsNote"] = primary["kids_note"]
        # 二期字段：菜单（餐饮点 / 并入酒店与书屋的菜单）
        menu = build_menu_payload(map_name, MENUS_BY_POINT)
        if menu:
            archive["menu"] = menu
        archive["raw"] = raw

        l1_map[map_name] = archive
        menu_count = 0
        if menu:
            menu_count = len(menu["dishes"]) + len(menu["packages"])
        if group["hasExact"] and group["hasAlias"]:
            report_matched_by = "exact+alias"
        else:
            report_matched_by = group["matchedBy"]
        l1_report.append(
            {
                "mapName": map_name,
                "confidence": group["confidence"],
                "matchedBy": report_matched_by,
                "category": category,
                "area": SPOT_TO_AREA.get(map_name, primary.get("area_id", "")),
                "areaName": area_name_map().get(
                    SPOT_TO_AREA.get(map_name, primary.get("area_id", "")), ""
                ),
                "source": primary["source"],
                "mergedSources": merged_sources,
                "duplicateSources": duplicate_sources,
                "mergedAliases": group["aliases"],
                "hasMenu": bool(menu),
                "menuCount": menu_count,
            }
        )

    return l1_map, l1_report


# ===========================================================================
# 7. L2 片区 + L3 风格样本 + playItems
# ===========================================================================

def area_name_map():
    return {cfg["id"]: cfg["name"] for cfg in AREA_CONFIG}


def is_junk_play(text):
    """玩法条目过滤：标题/流程类、超长句子不进 playItems / L2 plays。"""
    text = clean_cell(text)
    if not text or len(text) > MAX_PLAY_CHARS:
        return True
    return any(pattern in text for pattern in PLAY_JUNK_PATTERNS)


def humanize_avg_price(text):
    """人均消费原文 → 一句话「人均约X元」；解析不出就省略（不猜）。"""
    text = clean_cell(text)
    if not text or is_missing(text):
        return ""
    if "人均" in text:
        match = re.search(
            r"人均约?\s*([0-9]+(?:\.[0-9]+)?(?:\s*[-~—]\s*[0-9]+(?:\.[0-9]+)?)?)\s*元",
            text,
        )
        if match:
            return "人均约%s元" % match.group(1).replace(" ", "")
        return ""
    first = re.split(r"[；;]", text)[0].strip()
    first = first.replace("r/人", "").replace("/人", "")
    first = re.sub(r"^约", "", first).strip()
    first = re.sub(r"元$", "", first).strip()
    first = first.replace("r", "")
    match = re.match(
        r"^([0-9]+(?:\.[0-9]+)?(?:\s*[-~—]\s*[0-9]+(?:\.[0-9]+)?)?)$", first
    )
    if match:
        return "人均约%s元" % match.group(1).replace(" ", "")
    return ""


def food_category(entity):
    """餐饮品类（从名称/标签推断，不编造菜系）。"""
    name = entity["name"]
    text = " ".join(entity["plays"] + entity["needs"])
    if "书屋" in name or "书院" in name:
        return "书吧/轻食"
    if "咖啡" in name or "咖啡" in text:
        return "咖啡店"
    if "餐吧" in name:
        return "音乐餐吧"
    if "酒吧" in name:
        return "酒吧"
    if "酒廊" in name:
        return "酒廊"
    if "海鲜" in name or "海鲜市场自选加工" in text:
        return "海鲜餐厅"
    if "中餐" in name:
        return "中餐厅"
    if "全日" in name or "自助" in text:
        return "自助/全日餐厅"
    if "书院" in name:
        return "书吧/茶点"
    if "食堂" in name or "面馆" in name or "汤粉" in name or "小吃/简餐" in text:
        return "本地小吃/简餐"
    if "餐厅" in name:
        return "海景餐厅" if ("海景" in text or "海边看日落" in text) else "餐厅"
    return "餐饮"


def food_note(entity):
    """L2 food.note：一句话「品类/位置 + 人均」，例如「临海音乐餐吧，人均约27元」。"""
    category = food_category(entity)
    text = " ".join(entity["plays"] + entity["needs"])
    seaside = any(k in text for k in ("海边", "海景", "看海", "日落", "沙滩"))
    prefix = "临海" if seaside and "海景" not in category and "临海" not in category else ""
    label = prefix + category
    avg_price = humanize_avg_price(entity["avg_price"])
    return label + ("，" + avg_price if avg_price else "")


def stay_note(entity):
    """L2 stay.note：一句话「档次/亲子标签 + 房价」，例如「精品海景民宿，房价¥300-700/晚」。"""
    parts = []
    if entity["category"]:
        parts.append(entity["category"])
    kids = clean_cell(entity.get("kids_note", ""))
    if kids:
        if "·" in kids:
            head, tail = kids.split("·", 1)
            kids = head + "（" + tail.replace("·", "·") + "）"
        parts.append(kids)
    budget = clean_cell(entity["budget"])
    if budget and not is_missing(budget):
        if budget[0] in "¥￥0123456789":
            parts.append("房价" + budget)
        else:
            parts.append("预算" + budget)
    return "，".join(parts)


def build_area_buckets(entities):
    buckets = {
        cfg["id"]: {
            "id": cfg["id"],
            "name": cfg["name"],
            "spots": list(cfg["spots"]),
            "plays": [],
            "food": [],
            "stay": [],
            "activities": [],
        }
        for cfg in AREA_CONFIG
    }
    seen_play = {aid: set() for aid in buckets}

    def add_play(area_id, text, audiences, needs, source):
        if not area_id or area_id not in buckets:
            return
        text = clean_cell(text)
        if not text or text in seen_play[area_id] or is_junk_play(text):
            return
        seen_play[area_id].add(text)
        item = {"text": text}
        if audiences:
            item["audiences"] = list(audiences)
        if needs:
            item["needs"] = list(needs)
        item["source"] = source
        buckets[area_id]["plays"].append(item)

    # 7.1 景点表（含 L1 与未匹配行）的玩法 → 片区；路线玩法挂到所有途经片区
    for entity in entities["spots"]:
        if entity["quarantine"]:
            continue
        targets = entity["traversal_areas"] if entity["is_route"] else [entity["area_id"]]
        for area_id in targets:
            for play in entity["plays"]:
                add_play(area_id, play, entity["audiences"], entity["needs"], entity["source"])

    # 7.2 购物段玩法（买手信/文创等）→ 片区
    for entity in entities["shops"]:
        if entity["quarantine"]:
            continue
        for play in entity["plays"]:
            add_play(entity["area_id"], play, entity["audiences"], entity["needs"], entity["source"])

    # 7.4 餐饮
    for entity in entities["foods"]:
        if entity["quarantine"] or entity["duplicate_of"]:
            continue
        buckets[entity["area_id"]]["food"].append(
            {
                "name": entity["name"],
                "note": food_note(entity),
                "source": entity["source"],
            }
        )

    # 7.5 住宿（含亲子标签/预算）
    for entity in entities["stays"]:
        if entity["quarantine"]:
            continue
        buckets[entity["area_id"]]["stay"].append(
            {
                "name": entity["name"],
                "note": stay_note(entity),
                "source": entity["source"],
            }
        )

    # 7.6 活动
    for entity in entities["activities"]:
        if entity["quarantine"]:
            continue
        item = {"text": entity["name"]}
        if entity["audiences"]:
            item["audiences"] = list(entity["audiences"])
        item["source"] = entity["source"]
        buckets[entity["area_id"]]["activities"].append(item)

    # 7.7 玩法每片区设硬上限，避免 _index.json 过大（景点表优先保留）
    truncated = {}
    for area_id, bucket in buckets.items():
        if len(bucket["plays"]) > MAX_AREA_PLAYS:
            truncated[area_id] = len(bucket["plays"]) - MAX_AREA_PLAYS
            bucket["plays"] = bucket["plays"][:MAX_AREA_PLAYS]

    return buckets, truncated


def build_play_items(entities, l1_map):
    """三级标签拆成原子玩法，全局按文本去重；spot 记来源实体（命中点位时用 mapName）。"""
    items = []
    seen = set()
    order = []
    order.extend(("spot", e) for e in entities["spots"])
    order.extend(("food", e) for e in entities["foods"])
    order.extend(("stay", e) for e in entities["stays"])
    order.extend(("shop", e) for e in entities["shops"] + entities["activities"])

    for kind, entity in order:
        if entity["quarantine"]:
            continue
        spot_name = entity.get("map_name") or entity["name"]
        for play in entity["plays"]:
            text = clean_cell(play)
            if not text or text in seen or is_junk_play(text):
                continue
            seen.add(text)
            item = {"spot": spot_name, "text": text}
            if entity["audiences"]:
                item["audiences"] = list(entity["audiences"])
            if entity["needs"]:
                item["needs"] = list(entity["needs"])
            item["source"] = entity["source"]
            items.append(item)
    return items


def extract_docx_paragraphs(path):
    namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    with zipfile.ZipFile(path) as archive:
        xml_bytes = archive.read("word/document.xml")
    root = etree.fromstring(xml_bytes)
    paragraphs = []
    for para in root.iter(namespace + "p"):
        text = "".join(node.text or "" for node in para.iter(namespace + "t")).strip()
        if text:
            paragraphs.append(text)
    return paragraphs


def style_ok(text):
    """styleSamples 收录标准：有语气/画面、无价格电话、无标题/流程/需求定义词。"""
    text = clean_cell(text)
    if not text or len(text) < 4 or len(text) > 26:
        return False
    if re.search(r"[¥￥]|元|电话|热线|微信|http|www", text):
        return False
    if PHONE_RE.search(text):
        return False
    if any(pattern in text for pattern in STYLE_JUNK_PATTERNS):
        return False
    if text.startswith(("追求", "关注", "希望", "强调", "寻找", "借助")):
        return False
    return True


def build_style_samples(play_items):
    """L3：只收 docx 攻略原文引语 + 三级标签里的画面短语，8–30 条；
    标题、流程词、填充要点、需求定义句一律不收（README 第 63 行，宁缺毋滥）。"""
    quotes = []
    docx_files = sorted((ROOT / "东澳岛").glob(DOCX_GLOB))
    for path in docx_files:
        if "攻略" not in path.name:  # 标题/流程类文档不参与，避免混入章节名
            continue
        try:
            paragraphs = extract_docx_paragraphs(path)
        except Exception:
            continue
        for para in paragraphs:
            for quote in QUOTE_RE.findall(para):
                quote = clean_cell(quote)
                if style_ok(quote) and quote not in quotes:
                    quotes.append(quote)

    picture = []
    per_source = {}
    for item in play_items:
        text = clean_cell(item["text"])
        source = item.get("source", "")
        if text in picture or not style_ok(text):
            continue
        if per_source.get(source, 0) >= 2:  # 同一来源最多 2 条，避免全是同一个点位
            continue
        if not any(keyword in text for keyword in PICTURE_KEYWORDS):
            continue
        per_source[source] = per_source.get(source, 0) + 1
        picture.append(text)

    samples = []
    for text in quotes[:10] + picture[:20]:
        if len(samples) >= 30:
            break
        if text and text not in samples:
            samples.append(text)
    # 数量不足 8 条时才用兜底（README：宁缺毋滥）
    for text in STYLE_FALLBACK:
        if len(samples) >= 8:
            break
        if style_ok(text) and text not in samples:
            samples.append(text)
    return samples[:30]


def build_index(areas, play_items, style_samples):
    return {
        "version": VERSION,
        "audiences": list(AUDIENCE_IDS),
        "areas": [areas[cfg["id"]] for cfg in AREA_CONFIG],
        "playItems": play_items,
        "styleSamples": style_samples,
        # 二期：新增 13 个点位的分类（stay/food/shop），供云函数判断走哪套 prompt
        "spotCategories": dict(SPOT_CATEGORY),
    }


# ===========================================================================
# 8. 注入长度估算（对齐 cloudfunctions/dongaoGenerate/corpus.js 的拼装方式）
# ===========================================================================

def format_spot_block(archive):
    lines = []
    labels = [
        ("duration", "建议停留："),
        ("bestTime", "最佳时段："),
        ("budget", "花费："),
        ("partySize", "适合人数："),
        ("booking", "预订："),
        ("location", "位置："),
    ]
    for key, label in labels:
        if archive.get(key):
            lines.append(label + archive[key])
    if archive.get("surroundings"):
        lines.append("周边：" + "、".join(archive["surroundings"][:4]))
    return "\n".join(lines)[:MAX_L1_CHARS]


def estimate_injection(map_name, l1_map, index):
    """按云函数检索策略粗估单次注入字符数。"""
    area = None
    for item in index["areas"]:
        if map_name in item["spots"]:
            area = item
            break
    parts = []
    archive = l1_map.get(map_name)
    if archive:
        parts.append("【点位档案】\n" + format_spot_block(archive))
    plays = []
    seen = set()
    if archive:
        for play in archive["plays"]:
            if play not in seen:
                seen.add(play)
                plays.append({"text": play})
    if area:
        for play in area["plays"]:
            if play["text"] not in seen:
                seen.add(play["text"])
                plays.append(play)
    plays = plays[:4]
    if plays:
        parts.append("【这一带可以做什么】\n" + "\n".join("- " + p["text"] for p in plays))
    if area and area["food"]:
        food = area["food"][0]
        parts.append(
            "【这一带可以吃什么】\n- " + food["name"] + ("：" + food["note"] if food["note"] else "")
        )
    styles = index.get("styleSamples", [])[:2]
    if styles:
        parts.append("【语气参考】\n- " + "\n- ".join(styles))
    return len("\n\n".join(parts))


# ===========================================================================
# 9. 覆盖率报告
# ===========================================================================

def build_coverage_report(entities, l1_map, l1_report, index, truncated_areas, input_stats):
    l1_names = set(l1_map.keys())
    matched = []
    for item in l1_report:
        matched.append(
            {
                "mapName": item["mapName"],
                "confidence": item["confidence"],
                "matchedBy": item["matchedBy"],
                "category": item.get("category", ""),
                "area": item["area"],
                "areaName": item["areaName"],
                "source": item["source"],
                "mergedSources": item["mergedSources"],
                "aliases": item["mergedAliases"],
                "hasMenu": item.get("hasMenu", False),
                "menuCount": item.get("menuCount", 0),
            }
        )

    area_by_spot = {}
    for cfg in AREA_CONFIG:
        for spot_name in cfg["spots"]:
            area_by_spot[spot_name] = cfg["id"]

    unmatched_spots = [
        {
            "mapName": name,
            "area": area_by_spot.get(name, ""),
            "fallback": "L2 片区玩法 + L3 风格样本",
        }
        for name in MAP_NAMES
        if name not in l1_names
    ]

    matched_rows = set()
    for item in l1_report:
        matched_rows.add(item["source"])
        for src in item["mergedSources"]:
            matched_rows.add(src)

    unmatched_rows = [
        {
            "name": entity["name"],
            "category": entity["category"],
            "source": entity["source"],
            "reason": "名称不在 %d 个 map_name（含已知别名）内，只进 L2 片区，不生成 L1" % len(MAP_NAMES),
            "area": entity["area_id"],
            "areaName": entity["area_name"],
        }
        for entity in entities["spots"]
        if not entity["quarantine"] and entity["source"] not in matched_rows
    ]

    quarantine = []
    for entity in entities["all"]:
        if entity["quarantine"]:
            quarantine.append(
                {
                    "name": entity["name"],
                    "kind": entity["kind"],
                    "source": entity["source"],
                    "reason": entity["quarantine_reason"],
                }
            )

    entity_aliases = [
        {
            "canonical": "山海经书屋",
            "members": ["景点表#15", "餐饮表#5", "购物活动表#6"],
            "rule": "以景点表为主档；餐饮/文创只并玩法、客群、营业时间与菜单",
            "applied": True,
        },
        {
            "canonical": "万觅书店",
            "members": ["景点表#11", "购物活动表#5"],
            "rule": "以景点表为主档；「万觅」与「万觅书店文创」映射到该点位（万觅餐吧已单独成为点位）",
            "applied": True,
        },
        {
            "canonical": "",
            "members": ["餐饮表#27（东澳湾海鲜餐厅）", "餐饮表#6（海湾海鲜餐厅）"],
            "rule": "高德上「东澳湾海鲜餐厅」在玲玎海岸渔港一楼卡4，但采集表「海湾海鲜餐厅」是否同一家无法确认；用户 2026-11-11 决定两家都不入点位库、不合并菜单",
            "applied": False,
        },
        {
            "canonical": "阿丽拉珠海东澳岛",
            "members": ["住宿表#3（阿丽拉珠海东澳岛（ALILA））"],
            "rule": "去掉尾部英文括号后缀（只匹配 ASCII，不影响「（博物馆类）」）",
            "applied": True,
        },
        {
            "canonical": "万山海洋生物科普馆",
            "members": ["景点表#26", "景点表#10（海洋科普馆）"],
            "rule": "去类型后缀 + 别名合并；玩法取并集",
            "applied": True,
        },
        {
            "canonical": "东澳岛海关遗址",
            "members": ["景点表#27（东澳海关遗址展览馆）"],
            "rule": "别名映射到 52 点位「东澳岛海关遗址」",
            "applied": True,
        },
        {
            "canonical": "渔·日落海景餐厅",
            "members": ["餐饮表#36（原表序号35）", "餐饮表#19（原表序号18 渔海鲜餐厅）"],
            "rule": "同址（绿岛路7号）+ 名称高度相似，保留信息更全的一条进 L2",
            "applied": True,
        },
    ]

    suggested_aliases = []
    for source_name, target_name, reason in REVIEW_ALIASES:
        suggested_aliases.append(
            {"from": source_name, "to": target_name, "reason": reason, "applied": False}
        )

    area_coverage = []
    for cfg in AREA_CONFIG:
        area_item = next(a for a in index["areas"] if a["id"] == cfg["id"])
        area_l1 = [n for n in cfg["spots"] if n in l1_names]
        area_coverage.append(
            {
                "id": cfg["id"],
                "name": cfg["name"],
                "spots": len(cfg["spots"]),
                "l1": len(area_l1),
                "l1Names": area_l1,
                "plays": len(area_item["plays"]),
                "food": len(area_item["food"]),
                "stay": len(area_item["stay"]),
                "activities": len(area_item["activities"]),
                "playsTruncated": truncated_areas.get(cfg["id"], 0),
            }
        )

    # 二期：新增点位清单（13 个：5 住宿 + 7 餐饮 + 1 购物/游客服务中心）
    l1_source_by_name = {item["mapName"]: item["source"] for item in l1_report}
    new_points = []
    for map_name, category in SPOT_CATEGORY.items():
        meta = SPOT_META.get(map_name, {})
        archive = l1_map.get(map_name)
        menu = archive.get("menu") if archive else None
        new_points.append(
            {
                "mapName": map_name,
                "category": category,
                "amapName": meta.get("amap_name", ""),
                "coords": meta.get("coords", ""),
                "dataSource": l1_source_by_name.get(map_name, ""),
                "hasL1": bool(archive),
                "menuCount": (len(menu["dishes"]) + len(menu["packages"])) if menu else 0,
            }
        )
    new_points_with_l1 = len([item for item in new_points if item["hasL1"]])

    # 二期：未纳入点位库清单（住宿 24 家、购物 2 家、不合并菜单 2 家、并入酒店的餐厅 4 家）
    non_point_stays = [e for e in entities["stays"] if not e.get("map_name")]
    not_included = []
    for entity in non_point_stays:
        not_included.append(
            {
                "name": entity["name"],
                "kind": "stay",
                "source": entity["source"],
                "reason": "用户决定不进点位库（住宿表 %d 家非点位住宿之一）；玩法仍作为 L2 片区语料"
                % len(non_point_stays),
            }
        )
    for entity in entities["shops"]:
        if entity.get("map_name"):
            continue
        not_included.append(
            {
                "name": entity["name"],
                "kind": "shop",
                "source": entity["source"],
                "reason": "购物段仅「东澳岛游客服务中心」进点位库；本店保留在 L2 片区语料，不单列点位",
            }
        )
    for shop, reason in MENU_NOT_INCLUDED.items():
        not_included.append(
            {
                "name": shop,
                "kind": "menu",
                "source": "餐厅菜单/" + shop,
                "reason": reason + "；转写结果保留在 东澳岛/data/menus/" + shop + ".json 供人工确认",
            }
        )
    for shop in (
        "格力东澳大酒店-蓝色海岸餐厅",
        "珠海东澳岛安麓酒店-安心全日餐厅",
        "珠海东澳岛安麓酒店-安麓书院",
        "珠海东澳岛安麓酒店-麓中餐厅",
    ):
        target = MENU_SHOP_TO_POINT.get(shop, "")
        not_included.append(
            {
                "name": shop,
                "kind": "food",
                "source": "餐厅菜单/" + shop,
                "reason": "菜单 JSON 已转写，但本轮只收餐饮目录（MENU_SCOPE_CATEGORIES），未并入「%s」的 L1；下一轮改配置即可合入" % target,
            }
        )

    # 二期：菜单覆盖 / 待补
    expected_menu_points = []
    for source_name, target in MENU_SHOP_TO_POINT.items():
        if target and target not in expected_menu_points:
            expected_menu_points.append(target)

    def _menu_ready(point):
        return build_menu_payload(point, MENUS_BY_POINT) is not None

    menu_pending = []
    for name in expected_menu_points:
        if _menu_ready(name):
            continue
        dirs = [source for source, target in MENU_SHOP_TO_POINT.items() if target == name]
        if name in MENUS_BY_POINT:
            reason = "菜单 JSON 已到，但过滤后无可用 dishes/packages（可能只有扫码海报/饮品，需人工补充）"
        elif (SPOT_CATEGORY.get(name, "") or "spot") not in MENU_SCOPE_CATEGORIES:
            reason = "酒店/书屋菜单另属下一轮增量（本轮不纳入 L1）"
        else:
            reason = "菜单转写 JSON 尚未落盘（餐厅菜单/%s）" % "、".join(dirs)
        menu_pending.append(
            {
                "mapName": name,
                "category": SPOT_CATEGORY.get(name, "spot"),
                "sourceDirs": dirs,
                "reason": reason,
            }
        )
    menu_stats = {
        "files": len(MENU_ROWS),
        "expectedPoints": len(expected_menu_points),
        # pointsWithJson：有菜单 JSON 的点位；pointsWithMenu：过滤后仍有可用条目的点位
        "pointsWithJson": len([name for name in expected_menu_points if name in MENUS_BY_POINT]),
        "pointsWithMenu": len([name for name in expected_menu_points if _menu_ready(name)]),
        "pendingPoints": len(menu_pending),
        "warnings": MENU_WARNINGS,
    }

    matched_spot_row_count = len([e for e in entities["spots"] if e["source"] in matched_rows])
    audience_counts = {aid: 0 for aid in AUDIENCE_IDS}
    for item in index["playItems"]:
        for aid in item.get("audiences", []):
            if aid in audience_counts:
                audience_counts[aid] += 1

    data_issues = [
        {
            "id": "no-coordinates",
            "severity": "P0（已知限制）",
            "issue": "5 份 xlsx 没有经纬度列；二期新增点位的坐标来自 initDongaoSpots 的 SPOTS_DATA（高德 POI）",
            "rule": "L1/L2 不输出 GPS/坐标；坐标只用于 coverage 报告的新增点位核对表",
            "result": "语料按 map_name 挂到 %d 个点位，未新增 POI" % len(MAP_NAMES),
        },
        {
            "id": "spot-table-mixed-entities",
            "severity": "P1",
            "issue": "景点表混入 1 条酒店（华发安麓酒店）与 2 条疑似线路名（黛绿/馨漫）",
            "rule": "分类错位进 quarantine，不生成 L1",
            "result": "quarantine 共 %d 条" % len(quarantine),
        },
        {
            "id": "shop-sheet-offset",
            "severity": "P2",
            "issue": "购物表表头在第 2 行、max_row=170（有效仅到 44 行）、15–22 列为空列、序号在活动段重置且购物段缺 #5",
            "rule": "固定 header=1，只取第 3–44 行与 14 个有效列，重建全局序号 1–42",
            "result": "shops_activities.csv 42 行（购物 5 / 活动 37）",
        },
        {
            "id": "kids-transposed",
            "severity": "P2",
            "issue": "亲子表是转置表（字段为行、4 家酒店为列），且 4 家与住宿表重复，预算口径不一致",
            "rule": "转置后按酒店名合并进住宿，只取亲子标签/设施写 stay note，不改住宿预算原文",
            "result": "kids_hotels.csv 4 行；4 家住宿补充亲子标签",
        },
        {
            "id": "audience-aliases",
            "severity": "P1",
            "issue": "客群一级标签有 8 种写法（Z世代/情侣、情侣客群、亲子、银发/休闲…）",
            "rule": "脚本 CONST 别名表归一为 couple/family/elder/hardcore",
            "result": "全部归一；未知写法会打印 warning",
        },
        {
            "id": "separator",
            "severity": "P2",
            "issue": "餐饮标签用全角「；」，其余表用「、」；标签内部含「/」",
            "rule": "按「；」「、」拆（括号内不拆），绝不按「/」拆",
            "result": "拆分安全，Z世代/情侣 保持整体",
        },
        {
            "id": "fullwidth-colon",
            "severity": "P2",
            "issue": "时段字段大量使用全角冒号（14：00-18：30）",
            "rule": "统一转半角后再输出",
            "result": "clean/corpus 中时段均为半角冒号",
        },
        {
            "id": "placeholder-open-hours",
            "severity": "P1",
            "issue": "餐饮营业时间有 6 条占位值（营业时间未设置 ×5、未知 ×1）",
            "rule": "视为缺失，不写 open_hours、不注入 prompt",
            "result": "缺失条目不输出",
        },
        {
            "id": "duplicate-entities",
            "severity": "P1",
            "issue": "山海经书屋跨 3 表、万觅系列跨表、海湾海鲜餐厅/东澳湾海鲜餐厅身份无法确认（用户决定两家都不入库）、渔海鲜餐厅与渔·日落海景餐厅同址，住宿多组地址/电话归属冲突",
            "rule": "建 entityAliases（景点优先）；住宿冲突不合并，列入建议人工复核",
            "result": "%d 组别名合并；%d 组待人工确认" % (len(entity_aliases), len(suggested_aliases)),
        },
        {
            "id": "price-text",
            "severity": "P2",
            "issue": "价格/人均是混写文本（100-116/人、115-120r/人、¥300-500/晚…）",
            "rule": "保留原文，不转数值，不做排序筛选",
            "result": "budget/avg_price 均为原文",
        },
        {
            "id": "booking-no-phone",
            "severity": "P1",
            "issue": "餐饮 35 条写「电话预约」但全表 0 个电话号码",
            "rule": "不输出、不注入电话；booking 保留原文",
            "result": "prompt 事实纪律已约束不得编造电话",
        },
        {
            "id": "pending-verification",
            "severity": "P1",
            "issue": "景点表存在「待实采确认」字段（海洋科普馆、黛绿、馨漫、海钓点等）",
            "rule": "L1 source.verified=待实采；待实采措辞不得当成确定事实",
            "result": "%d 份 L1：%d 份待实采 + %d 份已验证" % (
                len(l1_map),
                sum(1 for a in l1_map.values() if (a.get("source") or {}).get("verified") != "已验证"),
                sum(1 for a in l1_map.values() if (a.get("source") or {}).get("verified") == "已验证"),
            ),
        },
        {
            "id": "unmatched-rows",
            "severity": "P1（如实记录）",
            "issue": "景点表 29 行中只有 %d 行能映射到点位（其余是路线/玩法/待实采行）" % matched_spot_row_count,
            "rule": "其余只进 L2 片区，不硬塞 L1",
            "result": "L1 覆盖 %d/%d；%d 行进 unmatchedRows" % (len(l1_map), len(MAP_NAMES), len(unmatched_rows)),
        },
        {
            "id": "phase2-new-points",
            "severity": "P0（二期范围）",
            "issue": "二期在 52 个景点基础上新增 13 个点位（5 住宿 + 7 餐饮 + 1 游客服务中心），点位总数变为 %d" % len(MAP_NAMES),
            "rule": "新增点位由 area-map/SPOTS_DATA 提供坐标与分类；L1 从住宿/餐饮/购物表对应行生成",
            "result": "新增点位 L1 %d/%d；spotCategories 写入 _index.json" % (new_points_with_l1, len(SPOT_CATEGORY)),
        },
        {
            "id": "menu-corpus",
            "severity": "P1（并行输入）",
            "issue": "菜单语料来自并行转写（东澳岛/data/menus/*.json），可能缺文件或解析失败",
            "rule": "只使用菜单 JSON；缺失或无法映射记入 coverage 的菜单待补/告警，不阻断构建",
            "result": "读取 %d 个菜单文件；%d/%d 个预期点位有菜单；%d 个待补"
            % (menu_stats["files"], menu_stats["pointsWithMenu"], menu_stats["expectedPoints"], menu_stats["pendingPoints"]),
        },
        {
            "id": "stay-not-in-points",
            "severity": "P1",
            "issue": "住宿表 %d 家中 %d 家民宿/客栈/非点名酒店按用户决定不进点位库" % (len(entities["stays"]), len(non_point_stays)),
            "rule": "只保留玩法到 L2 片区语料，不生成 L1；5 家酒店作为二期新点位",
            "result": "未纳入清单见 report「未纳入清单」一节",
        },
    ]

    report = {
        "version": VERSION,
        "generatedAt": GENERATED_AT,
        "script": "scripts/build_dongao_corpus.py",
        "commands": "python scripts/build_dongao_corpus.py",
        "inputs": input_stats,
        "totals": {
            "spotCount": len(MAP_NAMES),
            "l1Count": len(l1_map),
            "l1Coverage": "%d/%d (%.1f%%)"
            % (len(l1_map), len(MAP_NAMES), len(l1_map) / float(len(MAP_NAMES)) * 100),
            "newPointCount": len(SPOT_CATEGORY),
            "newPointsWithL1": new_points_with_l1,
            "areaCount": len(AREA_CONFIG),
            "cleanRows": {
                "spots": len(entities["spots"]),
                "stays": len(entities["stays"]),
                "foods": len(entities["foods"]),
                "shops_activities": len(entities["shops"]) + len(entities["activities"]),
                "kids_hotels": len(entities["kids"]),
                "menus": len(MENU_ROWS),
            },
            "playItems": len(index["playItems"]),
            "styleSamples": len(index["styleSamples"]),
            "quarantine": len(quarantine),
            "menuStats": menu_stats,
            "audiencePlayCounts": audience_counts,
        },
        "matchedSpots": matched,
        "newPoints": new_points,
        "notIncluded": not_included,
        "menuPending": menu_pending,
        "menuStats": menu_stats,
        "unmatchedSpots": unmatched_spots,
        "unmatchedRows": unmatched_rows,
        "quarantine": quarantine,
        "entityAliases": entity_aliases,
        "suggestedAliases": suggested_aliases,
        "areaCoverage": area_coverage,
        "dataIssues": data_issues,
    }
    return report


# ===========================================================================
# 10. 自检
# ===========================================================================

def validate_in_memory(l1_map, index, report):
    problems = []
    warnings = []
    spot_count = len(MAP_NAMES)
    area_spots = []
    for item in index["areas"]:
        area_spots.extend(item["spots"])

    if len(area_spots) != spot_count or set(area_spots) != set(MAP_NAMES):
        problems.append("_index.areas 未完整覆盖 %d 点位（实际 %d 个）" % (spot_count, len(area_spots)))
    if len(area_spots) != len(set(area_spots)):
        problems.append("_index.areas 存在重复点位")

    for map_name, archive in l1_map.items():
        for key in ("mapName", "version", "source", "audiences", "plays"):
            if key not in archive:
                problems.append("L1 %s 缺少必填字段 %s" % (map_name, key))
        if archive.get("mapName") != map_name:
            problems.append("L1 文件名与 mapName 不一致：%s" % map_name)
        if map_name not in MAP_NAMES:
            problems.append("L1 mapName 不在 %d 点位内：%s" % (spot_count, map_name))
        if not archive.get("audiences"):
            problems.append("L1 %s audiences 为空" % map_name)
        if not 1 <= len(archive.get("plays", [])) <= 8:
            problems.append("L1 %s plays 数量越界：%d" % (map_name, len(archive.get("plays", []))))
        if set(archive.get("audiences", [])) - set(AUDIENCE_IDS):
            problems.append("L1 %s audiences 含非法值" % map_name)
        for optional in ("bestTime", "duration", "budget", "partySize", "booking",
                         "location", "openHours", "avgPrice"):
            if optional in archive and not clean_cell(archive[optional]):
                problems.append("L1 %s 可选字段 %s 为空串（应省略）" % (map_name, optional))
        for optional_list in ("surroundings", "needs"):
            if optional_list in archive:
                if not archive[optional_list] or any(not x for x in archive[optional_list]):
                    problems.append("L1 %s 可选数组 %s 含空值" % (map_name, optional_list))
        # 二期：分类字段只给新增 13 个点位
        if "category" in archive:
            category = archive["category"]
            if category not in ("stay", "food", "shop"):
                problems.append("L1 %s category 非法：%s" % (map_name, category))
            elif SPOT_CATEGORY.get(map_name) != category:
                problems.append("L1 %s category 与 area-map spotCategory 不一致" % map_name)
            elif category == "food" and "menu" not in archive:
                if map_name in MENUS_BY_POINT:
                    warnings.append("L1 %s 是餐饮点位，菜单 JSON 已到但无可用条目" % map_name)
                else:
                    warnings.append("L1 %s 是餐饮点位但暂无 menu（菜单待补）" % map_name)
        elif map_name in SPOT_CATEGORY:
            problems.append("新增点位 %s 缺少 category 字段" % map_name)
        elif map_name not in MAP_NAMES:
            pass
        # 二期：menu 结构
        if "menu" in archive:
            menu = archive["menu"]
            if not isinstance(menu, dict) or not menu.get("source"):
                problems.append("L1 %s menu 缺少 source" % map_name)
            else:
                if len(menu.get("dishes", [])) > MAX_MENU_DISHES:
                    problems.append("L1 %s menu.dishes 超过 %d 条" % (map_name, MAX_MENU_DISHES))
                if len(menu.get("packages", [])) > MAX_MENU_PACKAGES:
                    problems.append("L1 %s menu.packages 超过 %d 条" % (map_name, MAX_MENU_PACKAGES))
                if not menu.get("dishes") and not menu.get("packages"):
                    problems.append("L1 %s menu 为空对象" % map_name)
                for dish in menu.get("dishes", []):
                    if not clean_cell(dish.get("name")):
                        problems.append("L1 %s menu.dishes 有条目缺 name" % map_name)
                for package in menu.get("packages", []):
                    if not clean_cell(package.get("name")) or not package.get("items"):
                        problems.append("L1 %s menu.packages 条目缺 name/items" % map_name)

    # 二期：14 个新增点位必须都有 L1；洒哥/摸鱼不得生成 L1
    for map_name in SPOT_CATEGORY:
        if map_name not in l1_map:
            problems.append("二期新增点位缺少 L1：%s" % map_name)
    for excluded_name in MENU_NOT_INCLUDED:
        if excluded_name in l1_map:
            problems.append("未纳入点位不应生成 L1：%s" % excluded_name)
    if (index.get("spotCategories") or {}) != SPOT_CATEGORY:
        problems.append("_index.spotCategories 与 area-map spotCategory 不一致")

    # 菜单覆盖：缺失只告警，不阻断构建（菜单转写是并行输入）
    expected_menu_points = []
    for source_name, target in MENU_SHOP_TO_POINT.items():
        if target and target not in expected_menu_points:
            expected_menu_points.append(target)
    def _menu_ready(point):
        return build_menu_payload(point, MENUS_BY_POINT) is not None

    menu_missing = [name for name in expected_menu_points if not _menu_ready(name)]
    menu_empty = [name for name in menu_missing if name in MENUS_BY_POINT]
    if not MENU_ROWS:
        warnings.append("菜单 JSON 尚未落盘（东澳岛/data/menus/ 为空），%d 个预期点位 menu 待补" % len(expected_menu_points))
    elif menu_missing:
        extra = ("；其中 %s 有 JSON 但无可用条目" % "、".join(menu_empty)) if menu_empty else ""
        warnings.append("菜单待补 %d 个点位：%s%s" % (len(menu_missing), "、".join(menu_missing), extra))
    for warning in MENU_WARNINGS:
        warnings.append("菜单输入：" + warning)

    if not 8 <= len(index["styleSamples"]) <= 30:
        problems.append("styleSamples 数量不在 8–30：%d" % len(index["styleSamples"]))
    if report["totals"]["playItems"] < 80:
        problems.append("playItems 少于 80 条：%d" % report["totals"]["playItems"])

    max_l1_chars = 0
    max_inject = 0
    max_inject_spot = ""
    for map_name, archive in l1_map.items():
        text = format_spot_block(archive)
        max_l1_chars = max(max_l1_chars, len(text))
        if len(text) > MAX_L1_CHARS:
            problems.append("L1 %s 注入块超过 %d 字符" % (map_name, MAX_L1_CHARS))
    for map_name in MAP_NAMES:
        chars = estimate_injection(map_name, l1_map, index)
        if chars > max_inject:
            max_inject = chars
            max_inject_spot = map_name
    if max_inject > MAX_INJECT_CHARS:
        problems.append("估算注入超过 %d 字符（%s：%d）" % (MAX_INJECT_CHARS, max_inject_spot, max_inject))

    self_check = {
        "jsonParsed": True,
        "utf8NoBom": True,
        "spotCount": spot_count,
        "areasCoverAll": len(area_spots) == spot_count and set(area_spots) == set(MAP_NAMES),
        "l1Count": len(l1_map),
        "newPointCount": len(SPOT_CATEGORY),
        "newPointL1Ok": all(name in l1_map for name in SPOT_CATEGORY),
        "excludedNoL1": not any(name in l1_map for name in MENU_NOT_INCLUDED),
        "menuJsonPoints": len([name for name in expected_menu_points if name in MENUS_BY_POINT]),
        "menuPoints": len([name for name in expected_menu_points if _menu_ready(name)]),
        "menuPending": len(menu_missing),
        "l1NamesValid": all(n in MAP_NAMES for n in l1_map),
        "requiredFieldsOk": not any("必填" in p or "为空" in p for p in problems),
        "maxL1Chars": max_l1_chars,
        "maxEstimatedInjection": max_inject,
        "maxEstimatedInjectionSpot": max_inject_spot,
        "l1Under600": max_l1_chars <= MAX_L1_CHARS,
        "injectionUnder1200": max_inject <= MAX_INJECT_CHARS,
        "warnings": warnings,
        "problems": problems,
    }
    return self_check, problems


def validate_on_disk(l1_map, index):
    problems = []
    expected_files = {name + ".json" for name in l1_map}
    actual_files = {p.name for p in CORPUS_DIR.glob("*.json") if p.name != "_index.json"}
    if expected_files != actual_files:
        problems.append(
            "_index 缺失或多余：多 %s / 少 %s"
            % (sorted(actual_files - expected_files), sorted(expected_files - actual_files))
        )
    for path in CORPUS_DIR.glob("*.json"):
        raw = path.read_bytes()
        if raw.startswith(b"\xef\xbb\xbf"):
            problems.append("%s 带 BOM" % path.name)
        try:
            json.loads(raw.decode("utf-8"))
        except Exception as exc:  # pragma: no cover
            problems.append("%s 解析失败：%s" % (path.name, exc))
    index_path = CORPUS_DIR / "_index.json"
    if not index_path.exists():
        problems.append("缺少 _index.json")
    return problems


# ===========================================================================
# 11. 写 CSV / JSON / 报告
# ===========================================================================

SPOT_CSV_FIELDS = [
    "seq", "category", "name", "audiences", "needs", "plays", "location",
    "surroundings", "best_time", "duration", "budget", "party_size", "booking",
    "verified", "map_name", "match_confidence", "area_id", "area_name",
    "is_quarantine", "quarantine_reason", "source_file", "source_sheet", "source_row",
]
STAY_CSV_FIELDS = [
    "seq", "category", "name", "audiences", "needs", "plays", "location",
    "surroundings", "best_time", "duration", "budget", "party_size", "booking",
    "verified", "area_id", "area_name", "kids_tag", "kids_note",
    "source_file", "source_sheet", "source_row",
]
FOOD_CSV_FIELDS = [
    "seq", "name", "audiences", "needs", "plays", "location", "surroundings",
    "open_hours", "avg_price", "booking", "duplicate_of", "area_id", "area_name",
    "source_file", "source_sheet", "source_row",
]
SHOP_CSV_FIELDS = [
    "seq", "category", "orig_seq", "name", "audiences", "needs", "plays",
    "location", "surroundings", "best_time", "duration", "budget",
    "party_size", "booking", "checked_note", "area_id", "area_name",
    "source_file", "source_sheet", "source_row",
]
KIDS_CSV_FIELDS = [
    "hotel_name", "audience_label", "needs", "scenes", "location",
    "surroundings", "best_time", "duration", "budget", "party_size", "booking",
    "pending_checks", "matched_stay", "source_file", "source_sheet", "source_col",
]
MENUS_CSV_FIELDS = [
    "shop", "map_name", "source_dir", "kind", "packages", "dishes", "uncertain", "source_files",
]


def write_csv(path, fieldnames, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def write_json(path, data):
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    # 固定 LF，避免 Windows 文本模式把 JSON 写成 CRLF（与小仓库其余 JSON 一致）
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def write_clean_csvs(entities, l1_map, matched_rows_by_name):
    spots_rows = []
    for index, entity in enumerate(entities["spots"], start=1):
        matched = matched_rows_by_name.get(entity["source"], {})
        spots_rows.append(
            {
                "seq": index,
                "category": entity["category"],
                "name": entity["name"],
                "audiences": "|".join(entity["audiences"]),
                "needs": "、".join(entity["needs"]),
                "plays": "、".join(entity["plays"]),
                "location": entity["location"],
                "surroundings": "；".join(entity["surroundings"]),
                "best_time": entity["best_time"],
                "duration": entity["duration"],
                "budget": entity["budget"],
                "party_size": entity["party_size"],
                "booking": entity["booking"],
                "verified": entity["verified"],
                "map_name": matched.get("mapName", ""),
                "match_confidence": matched.get("confidence", ""),
                "area_id": entity["area_id"],
                "area_name": entity["area_name"],
                "is_quarantine": "是" if entity["quarantine"] else "",
                "quarantine_reason": entity["quarantine_reason"],
                "source_file": entity["source_file"],
                "source_sheet": entity["source_sheet"],
                "source_row": entity["source_row"],
            }
        )
    write_csv(CLEAN_DIR / "spots.csv", SPOT_CSV_FIELDS, spots_rows)

    stays_rows = []
    for index, entity in enumerate(entities["stays"], start=1):
        stays_rows.append(
            {
                "seq": index,
                "category": entity["category"],
                "name": entity["name"],
                "audiences": "|".join(entity["audiences"]),
                "needs": "、".join(entity["needs"]),
                "plays": "、".join(entity["plays"]),
                "location": entity["location"],
                "surroundings": "；".join(entity["surroundings"]),
                "best_time": entity["best_time"],
                "duration": entity["duration"],
                "budget": entity["budget"],
                "party_size": entity["party_size"],
                "booking": entity["booking"],
                "verified": entity["verified"],
                "area_id": entity["area_id"],
                "area_name": entity["area_name"],
                "kids_tag": entity.get("kids_tag", ""),
                "kids_note": entity.get("kids_note", ""),
                "source_file": entity["source_file"],
                "source_sheet": entity["source_sheet"],
                "source_row": entity["source_row"],
            }
        )
    write_csv(CLEAN_DIR / "stays.csv", STAY_CSV_FIELDS, stays_rows)

    foods_rows = []
    for index, entity in enumerate(entities["foods"], start=1):
        foods_rows.append(
            {
                "seq": index,
                "name": entity["name"],
                "audiences": "|".join(entity["audiences"]),
                "needs": "、".join(entity["needs"]),
                "plays": "、".join(entity["plays"]),
                "location": entity["location"],
                "surroundings": "；".join(entity["surroundings"]),
                "open_hours": entity["open_hours"],
                "avg_price": entity["avg_price"],
                "booking": entity["booking"],
                "duplicate_of": entity["duplicate_of"],
                "area_id": entity["area_id"],
                "area_name": entity["area_name"],
                "source_file": entity["source_file"],
                "source_sheet": entity["source_sheet"],
                "source_row": entity["source_row"],
            }
        )
    write_csv(CLEAN_DIR / "foods.csv", FOOD_CSV_FIELDS, foods_rows)

    shop_rows = []
    for entity in entities["shops"] + entities["activities"]:
        shop_rows.append(
            {
                "seq": entity.get("global_seq", ""),
                "category": entity["category"],
                "orig_seq": entity["orig_seq"],
                "name": entity["name"],
                "audiences": "|".join(entity["audiences"]),
                "needs": "、".join(entity["needs"]),
                "plays": "、".join(entity["plays"]),
                "location": entity["location"],
                "surroundings": "；".join(entity["surroundings"]),
                "best_time": entity["best_time"],
                "duration": entity["duration"],
                "budget": entity["budget"],
                "party_size": entity["party_size"],
                "booking": entity["booking"],
                "checked_note": entity.get("checked_note", ""),
                "area_id": entity["area_id"],
                "area_name": entity["area_name"],
                "source_file": entity["source_file"],
                "source_sheet": entity["source_sheet"],
                "source_row": entity["source_row"],
            }
        )
    shop_rows.sort(key=lambda row: int(row["seq"]) if str(row["seq"]).isdigit() else 0)
    write_csv(CLEAN_DIR / "shops_activities.csv", SHOP_CSV_FIELDS, shop_rows)

    kids_rows = []
    for kids in entities["kids"]:
        kids_rows.append(
            {
                "hotel_name": kids["name"],
                "audience_label": kids.get("一级标签", ""),
                "needs": kids.get("二级标签（亲子需求）", ""),
                "scenes": kids.get("三级标签（具体场景）", ""),
                "location": kids.get("核心地点", ""),
                "surroundings": kids.get("周边情况", ""),
                "best_time": kids.get("最佳时段", ""),
                "duration": kids.get("游玩时长", ""),
                "budget": kids.get("预算区间", ""),
                "party_size": kids.get("适配人数", ""),
                "booking": kids.get("预订方式", ""),
                "pending_checks": kids.get("实采待核验项", ""),
                "matched_stay": kids.get("matched_stay", ""),
                "source_file": kids["source_file"],
                "source_sheet": kids["source_sheet"],
                "source_col": kids["source_col"],
            }
        )
    write_csv(CLEAN_DIR / "kids_hotels.csv", KIDS_CSV_FIELDS, kids_rows)

    # 二期：菜单转写中间表（供人工复核；未纳入/待补也会出现在这里）
    menu_rows = []
    for row in MENU_ROWS:
        menu_rows.append(
            {
                "shop": row.get("shop", ""),
                "map_name": row.get("map_name", ""),
                "source_dir": row.get("_dir", ""),
                "kind": row.get("kind", ""),
                "packages": row.get("packages", ""),
                "dishes": row.get("dishes", ""),
                "uncertain": row.get("uncertain", ""),
                "source_files": row.get("source_files", ""),
            }
        )
    write_csv(CLEAN_DIR / "menus.csv", MENUS_CSV_FIELDS, menu_rows)


def write_corpus(l1_map, index):
    CORPUS_DIR.mkdir(parents=True, exist_ok=True)
    for path in CORPUS_DIR.glob("*.json"):
        path.unlink()
    write_json(CORPUS_DIR / "_index.json", index)
    for map_name, archive in l1_map.items():
        write_json(CORPUS_DIR / (map_name + ".json"), archive)


def write_report(report, index, l1_map):
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(REPORT_DIR / "coverage.json", report)
    lines = []
    lines.append("# 东澳岛语料库覆盖率报告")
    lines.append("")
    lines.append("- 版本：%s；生成时间：%s" % (report["version"], report["generatedAt"]))
    lines.append("- 构建脚本：%s；复跑：%s" % (report["script"], report["commands"]))
    lines.append("- 字段契约：东澳岛/data/corpus/README.md")
    lines.append("- 编码：JSON 为 UTF-8 无 BOM；clean CSV 为 UTF-8 with BOM（方便 Excel 直接打开）")
    lines.append("- 来源标注：source 里的 #数字 是 Excel 行号（如「餐饮表#19」= Excel 第 19 行 / 原表序号 18）")
    lines.append("")
    totals = report["totals"]
    menu_stats = totals.get("menuStats", {})
    unmatched_count = len(report.get("unmatchedSpots", []))
    lines.append("## 1. 总览")
    lines.append("")
    lines.append("| 指标 | 数值 |")
    lines.append("| --- | --- |")
    lines.append("| 点位总数 | %d |" % totals.get("spotCount", len(l1_map)))
    lines.append("| L1 覆盖 | %s |" % totals["l1Coverage"])
    lines.append("| 二期新增点位 | %d（其中有 L1 %d） |" % (
        totals.get("newPointCount", 0), totals.get("newPointsWithL1", 0)))
    lines.append("| 片区数 | %d |" % totals["areaCount"])
    lines.append("| 玩法条目（去重） | %d |" % totals["playItems"])
    lines.append("| 风格样本 | %d |" % totals["styleSamples"])
    lines.append("| 菜单语料 | %d 个文件；%d 个点位有 JSON（其中 %d 个有可用条目），%d 个待补/%d 个预期点位 |" % (
        menu_stats.get("files", 0), menu_stats.get("pointsWithJson", 0),
        menu_stats.get("pointsWithMenu", 0), menu_stats.get("pendingPoints", 0),
        menu_stats.get("expectedPoints", 0)))
    lines.append("| quarantine | %d |" % totals["quarantine"])
    lines.append("")
    lines.append("清洗中间表行数：")
    lines.append("")
    lines.append("| 文件 | 行数 |")
    lines.append("| --- | --- |")
    for key, value in totals["cleanRows"].items():
        lines.append("| clean/%s.csv | %d |" % (key, value))
    lines.append("")
    lines.append("## 2. L1 命中点位（%d / %d）" % (totals["l1Count"], totals.get("spotCount", 0)))
    lines.append("")
    lines.append("| map_name | 分类 | 置信度 | 匹配方式 | 片区 | 来源 | 菜单 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- |")
    for item in report["matchedSpots"]:
        lines.append(
            "| %s | %s | %s | %s | %s | %s | %s |"
            % (
                item["mapName"],
                item.get("category") or "spot",
                item["confidence"],
                item["matchedBy"],
                item["areaName"],
                item["source"],
                ("%d 条" % item.get("menuCount")) if item.get("hasMenu") else "-",
            )
        )
    lines.append("")
    lines.append("52 个景点首期命中 12 个；二期新增 13 个点位全部有 L1。未命中的点位继续靠 L2 片区玩法 + L3 语气样本，不硬塞 L1。")
    lines.append("")
    lines.append("## 3. 二期新增点位")
    lines.append("")
    lines.append("| map_name | 分类 | 高德名称 | 坐标 | 数据来源 | 是否有 L1 | 菜单条数 |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- |")
    for item in report.get("newPoints", []):
        lines.append(
            "| %s | %s | %s | %s | %s | %s | %d |"
            % (
                item["mapName"],
                item["category"],
                item.get("amapName", ""),
                item.get("coords", ""),
                item.get("dataSource", ""),
                "是" if item.get("hasL1") else "否",
                item.get("menuCount", 0),
            )
        )
    lines.append("")
    lines.append("## 4. 未纳入清单")
    lines.append("")
    lines.append("| 名称 | 类型 | 来源 | 原因 |")
    lines.append("| --- | --- | --- | --- |")
    for item in report.get("notIncluded", []):
        lines.append(
            "| %s | %s | %s | %s |"
            % (item["name"], item.get("kind", ""), item.get("source", ""), item.get("reason", ""))
        )
    lines.append("")
    lines.append("## 5. 片区覆盖")
    lines.append("")
    lines.append("| 片区 | 点位数 | L1 | 玩法 plays | 餐饮 food | 住宿 stay | 活动 activities |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- |")
    for area in report["areaCoverage"]:
        lines.append(
            "| %s（%s） | %d | %d | %d | %d | %d | %d |"
            % (
                area["name"],
                area["id"],
                area["spots"],
                area["l1"],
                area["plays"],
                area["food"],
                area["stay"],
                area["activities"],
            )
        )
    lines.append("")
    lines.append("说明：南岸片（nanya）有 1 家住宿（阿丽拉珠海东澳岛），没有直接采集到的餐饮/活动；")
    lines.append("plays 来自途经该片区的倚山揽海路（摆渡车路线）三级标签；其他片区均按地址/名称关键词就近归属。")
    lines.append("")
    lines.append("## 6. 未匹配到 L1 的景点表行（unmatchedRows）")
    lines.append("")
    lines.append("| 名称 | 类别 | 来源 | 归属片区 |")
    lines.append("| --- | --- | --- | --- |")
    for row in report["unmatchedRows"]:
        lines.append("| %s | %s | %s | %s |" % (row["name"], row["category"], row["source"], row["areaName"]))
    lines.append("")
    lines.append("另有 %d 个点位没有 L1，完整清单见 coverage.json → unmatchedSpots。" % unmatched_count)
    lines.append("")
    lines.append("## 7. quarantine（不进 L1 / L2）")
    lines.append("")
    lines.append("| 名称 | 类型 | 来源 | 原因 |")
    lines.append("| --- | --- | --- | --- |")
    for item in report["quarantine"]:
        lines.append("| %s | %s | %s | %s |" % (item["name"], item["kind"], item["source"], item["reason"]))
    lines.append("")
    lines.append("## 8. 实体别名与待人工复核")
    lines.append("")
    lines.append("已应用的合并：")
    lines.append("")
    lines.append("| 主档 | 合并成员 | 规则 |")
    lines.append("| --- | --- | --- |")
    for item in report["entityAliases"]:
        lines.append("| %s | %s | %s |" % (item["canonical"], "、".join(item["members"]), item["rule"]))
    lines.append("")
    lines.append("待人工确认（未合并）：")
    lines.append("")
    lines.append("| 名称 | 疑似对应 | 原因 |")
    lines.append("| --- | --- | --- |")
    for item in report["suggestedAliases"]:
        lines.append("| %s | %s | %s |" % (item["from"], item["to"], item["reason"]))
    lines.append("")
    lines.append("## 9. 数据问题与处理规则")
    lines.append("")
    lines.append("| # | 级别 | 问题 | 规则 | 结果 |")
    lines.append("| --- | --- | --- | --- | --- |")
    for index_no, issue in enumerate(report["dataIssues"], start=1):
        lines.append(
            "| %d | %s | %s | %s | %s |"
            % (index_no, issue["severity"], issue["issue"], issue["rule"], issue["result"])
        )
    lines.append("")
    lines.append("## 10. 菜单待补")
    lines.append("")
    pending = report.get("menuPending", [])
    if pending:
        pending_dirs = []
        for item in pending:
            for directory in item.get("sourceDirs", []):
                if directory not in pending_dirs:
                    pending_dirs.append(directory)
        lines.append("待补目录（%d 个）：%s" % (len(pending_dirs), "、".join(pending_dirs)))
        lines.append("")
        lines.append("| map_name | 分类 | 菜单目录 | 原因 |")
        lines.append("| --- | --- | --- | --- |")
        for item in pending:
            lines.append(
                "| %s | %s | %s | %s |"
                % (item["mapName"], item.get("category", ""),
                   "、".join(item.get("sourceDirs", [])), item.get("reason", ""))
            )
    else:
        lines.append("全部预期点位已有菜单 JSON。")
    lines.append("")
    menu_warnings = menu_stats.get("warnings", [])
    if menu_warnings:
        lines.append("菜单输入告警：")
        lines.append("")
        for warning in menu_warnings:
            lines.append("- %s" % warning)
        lines.append("")
    lines.append("## 11. 自检结果")
    lines.append("")
    checks = report["selfCheck"]
    lines.append("| 检查项 | 结果 |")
    lines.append("| --- | --- |")
    lines.append("| JSON 可解析 / UTF-8 无 BOM | %s |" % ("通过" if checks["jsonParsed"] and checks["utf8NoBom"] else "失败"))
    lines.append("| %d 点位片区全覆盖、不重复 | %s |" % (
        checks.get("spotCount", 0), "通过" if checks.get("areasCoverAll") else "失败"))
    lines.append("| L1 文件名与 map_name 一致 | %s |" % ("通过" if checks["l1NamesValid"] else "失败"))
    lines.append("| 二期新增点位均有 L1（%d/%d） | %s |" % (
        checks.get("newPointCount", 0) if checks.get("newPointL1Ok") else 0,
        checks.get("newPointCount", 0),
        "通过" if checks.get("newPointL1Ok") else "失败"))
    lines.append("| 未纳入点位不生成 L1 | %s |" % ("通过" if checks.get("excludedNoL1") else "失败"))
    lines.append("| 必填字段非空 | %s |" % ("通过" if checks["requiredFieldsOk"] else "失败"))
    lines.append("| L1 注入 ≤600 字符（最大 %d） | %s |" % (checks["maxL1Chars"], "通过" if checks["l1Under600"] else "失败"))
    lines.append("| 估算注入 ≤1200 字符（最大 %d，%s） | %s |" % (
        checks["maxEstimatedInjection"], checks["maxEstimatedInjectionSpot"],
        "通过" if checks["injectionUnder1200"] else "失败"))
    lines.append("| 菜单点位（%d 个有 JSON，%d 个可用，%d 待补） | %s |" % (
        checks.get("menuJsonPoints", 0), checks.get("menuPoints", 0), checks.get("menuPending", 0),
        "待补（不阻断构建）" if checks.get("menuPending") else "通过"))
    lines.append("")
    if checks.get("problems"):
        lines.append("自检失败项：")
        lines.append("")
        for problem in checks["problems"]:
            lines.append("- %s" % problem)
        lines.append("")
    if checks.get("warnings"):
        lines.append("自检告警（不阻断）：")
        lines.append("")
        for warning in checks["warnings"]:
            lines.append("- %s" % warning)
        lines.append("")
    lines.append("## 12. 使用与回滚")
    lines.append("")
    lines.append("1. 上传 东澳岛/data/corpus/ 下全部 JSON 到云存储 dongao-corpus/（_index.json + L1 档案）；")
    lines.append("2. 云函数按 map_name 读 L1，读不到退回 _index.json 的 L2 + L3；food/stay/shop 分类见 _index.json → spotCategories；")
    lines.append("3. 语料异常时 DONGAO_CORPUS_ENABLED=0 回滚到旧 prompt。")
    lines.append("")
    (REPORT_DIR / "coverage.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


# ===========================================================================
# 12. main
# ===========================================================================

def print_summary(entities, l1_map, index, report, self_check, dry_run):
    totals = report["totals"]
    menu_stats = totals.get("menuStats", {})
    print("[build] version=%s dry_run=%s" % (VERSION, dry_run))
    print("[clean] spots=%d stays=%d foods=%d shops_activities=%d kids=%d menus=%d" % (
        totals["cleanRows"]["spots"],
        totals["cleanRows"]["stays"],
        totals["cleanRows"]["foods"],
        totals["cleanRows"]["shops_activities"],
        totals["cleanRows"]["kids_hotels"],
        totals["cleanRows"]["menus"],
    ))
    print("[points] total=%d L1=%d (%s) newPoints=%d/%d spotCategories=%d" % (
        totals["spotCount"], totals["l1Count"], totals["l1Coverage"],
        totals["newPointsWithL1"], totals["newPointCount"], len(index.get("spotCategories", {}))))
    print("[corpus] areas=%d playItems=%d styleSamples=%d" % (
        totals["areaCount"], totals["playItems"], totals["styleSamples"]))
    print("[menus] files=%d pointsWithJson=%d usable=%d/%d pending=%d" % (
        menu_stats.get("files", 0), menu_stats.get("pointsWithJson", 0),
        menu_stats.get("pointsWithMenu", 0), menu_stats.get("expectedPoints", 0),
        menu_stats.get("pendingPoints", 0)))
    print("[quarantine] %d: %s" % (
        totals["quarantine"], "、".join(item["name"] for item in report["quarantine"])))
    print("[selfcheck] areasAll=%s newPointL1=%s excludedNoL1=%s required=%s maxL1=%d maxInject=%d" % (
        self_check.get("areasCoverAll"),
        self_check.get("newPointL1Ok"),
        self_check.get("excludedNoL1"),
        self_check["requiredFieldsOk"],
        self_check["maxL1Chars"],
        self_check["maxEstimatedInjection"],
    ))
    if self_check.get("problems"):
        print("[selfcheck] problems:")
        for problem in self_check["problems"]:
            print("  - " + problem)
    if self_check.get("warnings"):
        print("[selfcheck] warnings:")
        for warning in self_check["warnings"]:
            print("  - " + warning)
    if dry_run:
        print("[dry-run] 未写入任何文件")
    else:
        print("[write] %s" % CLEAN_DIR)
        print("[write] %s" % CORPUS_DIR)
        print("[write] %s" % REPORT_DIR)


def main():
    parser = argparse.ArgumentParser(description="东澳岛 AI 检索式语料库构建脚本")
    parser.add_argument("--dry-run", action="store_true", help="只清洗与校验，不写任何文件")
    args = parser.parse_args()

    global MAP_NAMES, AREA_CONFIG, SPOT_TO_AREA, SPOT_META, SPOT_CATEGORY
    global MENUS_BY_POINT, MENU_ROWS, MENU_WARNINGS

    # A. 点位数量动态化：从 SPOTS_DATA 解析，与 area-map 交叉校验（当前 66）
    spot_meta = load_spot_meta()
    MAP_NAMES = [item["map_name"] for item in spot_meta]
    if len(MAP_NAMES) != len(set(MAP_NAMES)):
        raise SystemExit("initDongaoSpots 中 map_name 存在重复：%d 条" % len(MAP_NAMES))
    SPOT_META = {item["map_name"]: item for item in spot_meta}

    area_map = load_area_map()
    AREA_CONFIG = area_map["areas"]
    SPOT_TO_AREA = area_map["spotToArea"]
    SPOT_CATEGORY = dict(area_map.get("spotCategory") or {})

    area_map_spots = []
    for cfg in AREA_CONFIG:
        area_map_spots.extend(cfg["spots"])
    if len(area_map_spots) != len(MAP_NAMES) or set(area_map_spots) != set(MAP_NAMES):
        raise SystemExit(
            "area-map.json 与 initDongaoSpots 点位不一致：area-map %d 个 / SPOTS_DATA %d 个"
            % (len(area_map_spots), len(MAP_NAMES))
        )
    if set(SPOT_TO_AREA.keys()) != set(MAP_NAMES):
        raise SystemExit(
            "area-map.json spotToArea 与 SPOTS_DATA 点位不一致：%d / %d"
            % (len(SPOT_TO_AREA), len(MAP_NAMES))
        )
    for name, category in SPOT_CATEGORY.items():
        if name not in MAP_NAMES:
            raise SystemExit("area-map spotCategory 含未知点位：%s" % name)
        if category not in ("stay", "food", "shop"):
            raise SystemExit("area-map spotCategory 分类非法：%s → %s" % (name, category))
        if SPOT_META[name]["category"] != category:
            raise SystemExit(
                "分类不一致：%s 在 area-map 为 %s，在 SPOTS_DATA 为 %s"
                % (name, category, SPOT_META[name]["category"])
            )
    for name in MAP_NAMES:
        meta_category = SPOT_META[name]["category"]
        if meta_category and name not in SPOT_CATEGORY:
            raise SystemExit("SPOTS_DATA 有 category 但 area-map spotCategory 缺失：%s" % name)
        if not meta_category and name in SPOT_CATEGORY:
            raise SystemExit("area-map spotCategory 有多余分类：%s" % name)

    # D. 菜单语料（并行输入，允许目录为空/文件不全）
    MENU_ROWS, MENUS_BY_POINT, MENU_WARNINGS = load_menus()
    print("[input] spots=%d newPoints=%d menus=%d files -> %d points" % (
        len(MAP_NAMES), len(SPOT_CATEGORY), len(MENU_ROWS), len(MENUS_BY_POINT)))

    if not args.dry_run:
        CLEAN_DIR.mkdir(parents=True, exist_ok=True)
        CORPUS_DIR.mkdir(parents=True, exist_ok=True)
        REPORT_DIR.mkdir(parents=True, exist_ok=True)

    entities = prepare_entities()
    l1_map, l1_report = build_l1_archives(entities)
    areas, truncated = build_area_buckets(entities)
    play_items = build_play_items(entities, l1_map)
    style_samples = build_style_samples(play_items)
    index = build_index(areas, play_items, style_samples)

    matched_rows_by_name = {}
    for item in l1_report:
        matched_rows_by_name[item["source"]] = item
        for source in item["mergedSources"]:
            matched_rows_by_name[source] = item

    input_stats = [
        {
            "file": SPOTS_XLSX.name,
            "sheets": workbook_stats(SPOTS_XLSX),
            "headerRow": 1,
            "usedRows": "2–30（29 行；A 列合并分组 forward-fill）",
        },
        {
            "file": STAYS_XLSX.name,
            "sheets": workbook_stats(STAYS_XLSX),
            "headerRow": 1,
            "usedRows": "2–30（29 行）",
        },
        {
            "file": FOODS_XLSX.name,
            "sheets": workbook_stats(FOODS_XLSX),
            "headerRow": 1,
            "usedRows": "2–39（38 行）",
        },
        {
            "file": SHOPS_XLSX.name,
            "sheets": workbook_stats(SHOPS_XLSX),
            "headerRow": 2,
            "usedRows": "3–44（42 行；15–22 列空列丢弃）",
        },
        {
            "file": KIDS_XLSX.name,
            "sheets": workbook_stats(KIDS_XLSX),
            "headerRow": 1,
            "usedRows": "转置表：11 字段 × 4 家酒店",
        },
        {
            "file": "东澳岛/data/menus/*.json",
            "sheets": [],
            "headerRow": "-",
            "usedRows": "读取 %d 个菜单文件，映射 %d 个点位%s"
            % (len(MENU_ROWS), len(MENUS_BY_POINT), "；%d 条告警" % len(MENU_WARNINGS) if MENU_WARNINGS else ""),
        },
    ]

    report = build_coverage_report(entities, l1_map, l1_report, index, truncated, input_stats)
    self_check, problems = validate_in_memory(l1_map, index, report)
    report["selfCheck"] = self_check

    if not args.dry_run:
        write_clean_csvs(entities, l1_map, matched_rows_by_name)
        write_corpus(l1_map, index)
        write_report(report, index, l1_map)
        disk_problems = validate_on_disk(l1_map, index)
        self_check["problems"].extend(disk_problems)
        if disk_problems:
            self_check["jsonParsed"] = False
        report["selfCheck"] = self_check

    print_summary(entities, l1_map, index, report, self_check, args.dry_run)
    if problems or self_check.get("problems"):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

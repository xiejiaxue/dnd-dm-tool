#!/usr/bin/env python3
"""Overlay Chinese text on the left/right index panels of the Waterdeep map.

The central map and bottom-center harbor panel are copied pixel-for-pixel from the
source. English text is read from the seven location-index panels with Tesseract,
translated locally, and typeset over reconstructed parchment panel interiors.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageStat

try:
    import argostranslate.translate
except ImportError as exc:  # pragma: no cover - runtime prerequisite
    raise SystemExit("Run this script with the prepared Argos Translate environment") from exc


@dataclass(frozen=True)
class Column:
    box: tuple[int, int, int, int]
    first: int
    last: int
    skips: tuple[int, ...] = ()

    @property
    def numbers(self) -> tuple[int, ...]:
        return tuple(number for number in range(self.first, self.last + 1) if number not in self.skips)


@dataclass(frozen=True)
class Panel:
    key: str
    code: str
    title: str
    interior: tuple[int, int, int, int]
    title_y: int
    list_y: int
    columns: tuple[Column, ...]
    line_height: int
    body_size: int
    title_size: int = 68


PANELS = (
    Panel(
        "sea", "S", "滨海区", (82, 378, 1871, 1151), 405, 535,
        (Column((95, 525, 650, 1145), 1, 26), Column((660, 525, 1245, 1145), 27, 53), Column((1255, 525, 1855, 1145), 54, 79)),
        23, 19,
    ),
    Panel(
        "castle", "C", "城堡区", (82, 1537, 1871, 2752), 1568, 1740,
        (Column((95, 1728, 650, 2738), 1, 31), Column((660, 1728, 1245, 2738), 32, 60, (38,)), Column((1255, 1728, 1855, 2738), 61, 86)),
        30, 19,
    ),
    Panel(
        "dock", "D", "码头区", (82, 3202, 1871, 4173), 3225, 3388,
        (Column((95, 3378, 650, 4158), 1, 24), Column((660, 3378, 1245, 4158), 25, 49), Column((1255, 3378, 1855, 4158), 50, 74)),
        29, 19,
    ),
    Panel(
        "north", "N", "北区", (4120, 378, 5907, 1492), 405, 530,
        (Column((4135, 520, 4690, 1478), 1, 30), Column((4700, 520, 5280, 1478), 31, 57), Column((5290, 520, 5890, 1478), 58, 82)),
        29, 18,
    ),
    Panel(
        "trades", "T", "贸易区", (4120, 1614, 5907, 2392), 1640, 1788,
        (Column((4135, 1778, 4690, 2378), 1, 18), Column((4700, 1778, 5280, 2378), 19, 36), Column((5290, 1778, 5890, 2378), 37, 51)),
        31, 19,
    ),
    Panel(
        "dead", "CD", "死城", (4120, 2542, 5907, 2909), 2562, 2728,
        (Column((4125, 2685, 4700, 2898), 1, 5), Column((4690, 2685, 5290, 2898), 6, 10), Column((5280, 2685, 5900, 2898), 11, 14)),
        30, 19,
    ),
    Panel(
        "south", "S", "南区", (4120, 3164, 5907, 4014), 3190, 3370,
        (Column((4135, 3360, 4690, 4000), 1, 20), Column((4700, 3360, 5280, 4000), 21, 37), Column((5290, 3360, 5890, 4000), 38, 54)),
        29, 19,
    ),
)


FULL_NAME_OVERRIDES = {
    "Aurora's Realms Shop": "奥萝拉万界商店",
    "Aurora’s Realms Shop": "奥萝拉万界商店",
    "Blackstaff Tower": "黑杖塔",
    "Castle Waterdeep": "深水堡",
    "Field of Triumph": "凯旋之地",
    "House of Inspired Hands": "灵感之手神殿",
    "New Olamn": "新奥拉姆学院",
    "The Bent Nail": "弯钉",
    "The Butchers' Guildhall": "屠夫行会大厅",
    "The Butchers’ Guildhall": "屠夫行会大厅",
    "The Cynosure": "极星厅堂",
    "The Grinning Lion": "微笑雄狮",
    "The Gentle Rest Stables": "温柔安息马厩",
    "The House of Healing": "疗愈会馆",
    "The House of Heroes": "英雄神殿",
    "The House of the Moon": "月神殿",
    "The House of Wonder": "奇迹神殿",
    "The Plinth": "砥柱之基",
    "The Yawning Portal": "哈欠传送门",
    "Ahghairon's Tower": "阿格哈荣之塔",
    "Ahghairon’s Tower": "阿格哈荣之塔",
    "Heroes' Garden": "英雄花园",
    "Heroes’ Garden": "英雄花园",
    "Monastery of the Sun": "太阳修道院",
    "Mystra's Arms": "密斯特拉之怀",
    "Mystra’s Arms": "密斯特拉之怀",
    "Pantheon Temple of the Seldarine": "瑟达琳万神殿",
    "The Gray Griffon": "灰狮鹫",
    "Golden Harp Inn": "金竖琴旅店",
    "Sated Satyr": "醉羊人",
    "Selchoun's Sundries": "塞尔丘恩杂货铺",
    "Selchoun’s Sundries": "塞尔丘恩杂货铺",
    "The Blue Alley": "蓝巷",
    "The Shrines of Nature": "自然圣所",
    "Wavesilver Villa": "银浪庄园",
    "Wyvern's Rest": "双足飞龙之憩",
    "Wyvern’s Rest": "双足飞龙之憩",
    "The Purple Palace": "紫宫",
    "The Mermaid's Arms": "人鱼之拥",
    "The Mermaid’s Arms": "人鱼之拥",
    "The Blue Mermaid": "蓝美人鱼",
    "The Hanged Man": "吊死人",
    "The Blushing Mermaid": "绯红人鱼",
    "The Old Xoblob Shop": "老索布洛布商店",
    "The Underdark": "幽暗地域",
    "Inn of the Dripping Dagger": "滴血匕首旅店",
    "The Riven Shield Shop": "裂盾商店",
    "Citadel of the Arrow": "箭矢堡垒",
    "The Unicorn's Horn": "独角兽之角",
    "The Unicorn’s Horn": "独角兽之角",
    "Tymora's Blessing": "泰摩拉的祝福",
    "Tymora’s Blessing": "泰摩拉的祝福",
    "Waukeen's Wares": "渥金货栈",
    "Waukeen’s Wares": "渥金货栈",
}


TYPE_TRANSLATIONS = (
    ("wizard's domiciles", "法师宅邸"), ("wizards domiciles", "法师宅邸"),
    ("wizard's domicile", "法师宅邸"), ("temple of many faiths", "多信仰神殿"),
    ("business/row house", "商铺/联排住宅"), ("rooming house/inn", "公寓/旅店"),
    ("tavern/guildhall", "酒馆/行会大厅"), ("tavern/guild", "酒馆/行会"),
    ("city-building", "城市建筑"), ("city building", "城市建筑"),
    ("noble villa", "贵族庄园"), ("ruined building", "建筑遗址"),
    ("ruined inn", "旅店遗址"), ("home/business", "住宅/商铺"),
    ("guild house", "行会建筑"), ("row house", "联排住宅"),
    ("rowhouse", "联排住宅"), ("tavern/inn", "酒馆/旅店"),
    ("guildhall", "行会大厅"), ("warehouse", "仓库"),
    ("festhall", "宴乐馆"), ("monastery", "修道院"),
    ("residence", "住宅"), ("business", "商铺"), ("temple", "神殿"),
    ("tavern", "酒馆"), ("school", "学院"), ("embassy", "使馆"),
    ("asylum", "收容院"), ("storage", "仓储"), ("villa", "庄园"),
    ("house", "住宅"), ("inn", "旅店"), ("vault", "墓室"),
    ("tomb", "陵墓"),
)


TOKEN_OVERRIDES = {
    "Waterdeep": "深水城", "Mystra": "密斯特拉", "Azuth": "阿祖斯",
    "Tymora": "泰摩拉", "Waukeen": "渥金", "Seldarine": "瑟达琳",
    "Thayan": "塞尔", "Maztican": "马兹提卡", "Aurora": "奥萝拉",
    "Aghairon": "阿格哈荣", "Ahghairon": "阿格哈荣", "Piergeiron": "皮尔盖伦",
}


CATALOGUE_SUFFIXES = {
    "Singing Dolphin Catalog Counter": "歌唱海豚目录柜台",
    "Singing Dolphin Catalogue Counter": "歌唱海豚目录柜台",
    "Waterdeep Way Catalogue Count": "深水路目录柜台",
    "Waterdeep Way Catalogue Counter": "深水路目录柜台",
    "Slut Street Catalogue Counter": "荡妇街目录柜台",
    "High Road Catalogue Counter": "高路目录柜台",
    "Street of Tusks Catalogue Counter": "獠牙街目录柜台",
    "South High Road Catalogue Counter": "南高路目录柜台",
}


def load_english_words() -> set[str]:
    dictionary = Path("/usr/share/dict/words")
    if not dictionary.exists():
        return set()
    return {
        line.strip().lower()
        for line in dictionary.read_text(encoding="utf-8", errors="ignore").splitlines()
        if line.strip()
    }


ENGLISH_WORDS = load_english_words()


PHONETIC_CHUNKS = {
    "sch": "施", "tch": "奇", "air": "艾尔", "eer": "伊尔", "igh": "艾",
    "th": "瑟", "sh": "希", "ch": "奇", "ph": "菲", "wh": "维", "qu": "奎",
    "ck": "克", "gh": "格", "ng": "恩", "kh": "赫", "zh": "日",
    "br": "布尔", "cr": "克尔", "dr": "德尔", "fr": "弗尔", "gr": "格尔",
    "kr": "克尔", "pr": "普尔", "tr": "特尔", "vr": "弗尔", "wr": "尔",
    "st": "斯特", "sk": "斯克", "sp": "斯普", "sl": "斯尔", "sm": "斯姆",
    "sn": "斯恩", "sw": "斯维", "tw": "特维", "ll": "尔", "rr": "尔",
    "ee": "伊", "ea": "伊", "oo": "乌", "ou": "奥", "ow": "欧", "ai": "艾",
    "ay": "艾", "ei": "艾", "ey": "伊", "oi": "奥伊", "oy": "奥伊", "au": "奥",
    "a": "阿", "b": "布", "c": "克", "d": "德", "e": "埃", "f": "夫",
    "g": "格", "h": "赫", "i": "伊", "j": "杰", "k": "克", "l": "尔",
    "m": "姆", "n": "恩", "o": "奥", "p": "普", "q": "克", "r": "尔",
    "s": "斯", "t": "特", "u": "乌", "v": "夫", "w": "维", "x": "克斯",
    "y": "伊", "z": "兹",
}


def roman_to_hanzi(token: str) -> str:
    if token in TOKEN_OVERRIDES:
        return TOKEN_OVERRIDES[token]
    word = re.sub(r"[^A-Za-z]", "", token).lower()
    if not word:
        return token
    if len(word) > 3 and word.endswith("e"):
        word = word[:-1]
    out: list[str] = []
    i = 0
    while i < len(word):
        for width in (3, 2, 1):
            chunk = word[i:i + width]
            if chunk in PHONETIC_CHUNKS:
                out.append(PHONETIC_CHUNKS[chunk])
                i += width
                break
        else:
            i += 1
    # Compress repeated phonetic filler characters.
    text = "".join(out)
    return re.sub(r"(.)\1{2,}", r"\1\1", text)


def replace_latin_tokens(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        word = match.group(0)
        if len(word) == 1 and word.upper() in {"A", "B", "C", "D"}:
            return word.upper()
        return roman_to_hanzi(word)
    return re.sub(r"[A-Za-z][A-Za-z'’.-]*", repl, text)


def translate_meta(meta: str) -> str:
    translated = meta
    for english, chinese in TYPE_TRANSLATIONS:
        translated = re.sub(re.escape(english), chinese, translated, flags=re.IGNORECASE)
    translated = translated.replace("formerly", "原为").replace("n/a", "不适用")
    # OCR commonly confuses the floor suffix "s" with the digit 5.
    translated = re.sub(r"\b([1-6])5\b", r"\1s", translated)
    translated = re.sub(r"(?<=\d)s\b", "层", translated)
    translated = translated.replace(" & ", "、")
    return replace_latin_tokens(translated)


def translate_name(name: str) -> str:
    cleaned = re.sub(r"\s+", " ", name.strip(" ,"))
    for english, chinese in CATALOGUE_SUFFIXES.items():
        cleaned = cleaned.replace(english, chinese)
    for english, chinese in FULL_NAME_OVERRIDES.items():
        if cleaned == english:
            return chinese
        if cleaned.startswith(english + ","):
            return replace_latin_tokens(cleaned.replace(english, chinese, 1))

    # Keep invented Forgotten Realms names out of the general translation model,
    # then restore them as Chinese phonetic renderings.
    protected: dict[str, str] = {}
    counter = 0

    def protect(match: re.Match[str]) -> str:
        nonlocal counter
        token = match.group(0)
        possessive = token.endswith(("'s", "’s"))
        base = token[:-2] if possessive else token
        normalized = base.lower().strip(".-")
        if normalized in ENGLISH_WORDS or base in TOKEN_OVERRIDES or len(normalized) <= 2:
            return token
        marker = f"ZXQ{counter}QXZ"
        protected[marker] = roman_to_hanzi(base)
        counter += 1
        return marker + ("'s" if possessive else "")

    prepared = re.sub(r"[A-Za-z][A-Za-z.-]*(?:['’]s)?", protect, cleaned)
    translated = argostranslate.translate.translate(prepared, "en", "zh")
    for marker, chinese in protected.items():
        translated = translated.replace(marker, chinese)
    translated = translated.replace("别墅", "庄园").replace("城市大楼", "城市建筑")
    return replace_latin_tokens(translated)


ENTRY_START = re.compile(r"^\s*(?:\$|[A-Z]{1,2})?[0-9IOSilos]{1,3}\s*[:;]\s*(.*)$")


def ocr_column(image: Image.Image, column: Column) -> list[str]:
    crop = image.crop(column.box)
    crop = ImageEnhance.Contrast(crop).enhance(1.35)
    with tempfile.TemporaryDirectory(prefix="waterdeep-ocr-") as temp_dir:
        input_path = Path(temp_dir) / "column.png"
        crop.save(input_path)
        result = subprocess.run(
            ["tesseract", str(input_path), "stdout", "-l", "eng", "--psm", "6"],
            check=True, capture_output=True, text=True,
        )
    entries: list[str] = []
    current: list[str] | None = None
    for raw_line in result.stdout.splitlines():
        normalized_line = re.sub(r"[\\\[|](?=[0-9IOSilos]{1,3}\s*[:;])", " ", raw_line.strip())
        # In the Trades Ward's tiny type, a leading "T" is sometimes read as "71".
        normalized_line = re.sub(r"\b71(?=[0-9]{2}\s*[:;])", " ", normalized_line)
        if not normalized_line:
            continue
        # Tesseract occasionally merges two adjacent rows; split every embedded ID.
        segments = re.split(
            r"\s+(?=(?:\$|[A-Z]{0,2})?[0-9IOSilos]{1,3}\s*[:;])",
            normalized_line,
        )
        for line in segments:
            match = ENTRY_START.match(line)
            if match:
                if current:
                    entries.append(" ".join(current))
                current = [match.group(1)]
            elif current is not None:
                current.append(line)
    if current:
        entries.append(" ".join(current))
    expected = len(column.numbers)
    if len(entries) != expected:
        raise RuntimeError(
            f"OCR count mismatch for {column.box}: expected {expected}, found {len(entries)}\n"
            + "\n".join(f"{number}: {value}" for number, value in zip(column.numbers, entries))
        )
    return entries


def split_entry(entry: str) -> tuple[str, str]:
    normalized = re.sub(r"\s+", " ", entry).strip()
    if "(" not in normalized or not normalized.endswith(")"):
        return normalized, ""
    name, meta = normalized.rsplit("(", 1)
    return name.strip(" ,"), meta[:-1].strip()


def translated_entries(image: Image.Image) -> dict[str, list[dict[str, str | int]]]:
    result: dict[str, list[dict[str, str | int]]] = {}
    for panel in PANELS:
        panel_entries: list[dict[str, str | int]] = []
        for column in panel.columns:
            source_entries = ocr_column(image, column)
            for number, source in zip(column.numbers, source_entries):
                name, meta = split_entry(source)
                chinese_name = translate_name(name)
                chinese_meta = translate_meta(meta)
                panel_entries.append({
                    "number": number,
                    "source": source,
                    "name": chinese_name,
                    "meta": chinese_meta,
                })
        result[panel.key] = panel_entries
    return result


def parchment_fill(image: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    original = image.crop(box).convert("RGB")
    # A very broad blur removes glyphs while retaining the panel's natural tonal drift.
    blurred = original.filter(ImageFilter.GaussianBlur(radius=95))
    stat = ImageStat.Stat(original.resize((64, 64)).filter(ImageFilter.MedianFilter(5)))
    base_color = tuple(round(channel) for channel in stat.median)
    solid = Image.new("RGB", original.size, base_color)
    return Image.blend(blurred, solid, 0.63)


def fit_text(draw: ImageDraw.ImageDraw, text: str, font_path: str, max_size: int, max_width: int) -> ImageFont.FreeTypeFont:
    size = max_size
    while size >= 13:
        font = ImageFont.truetype(font_path, size)
        if draw.textlength(text, font=font) <= max_width:
            return font
        size -= 1
    return ImageFont.truetype(font_path, 13)


def render_panel(
    image: Image.Image,
    panel: Panel,
    entries: list[dict[str, str | int]],
    title_font_path: str,
    body_font_path: str,
) -> None:
    image.paste(parchment_fill(image, panel.interior), panel.interior[:2])
    draw = ImageDraw.Draw(image)
    ink = (31, 27, 24)
    title_font = ImageFont.truetype(title_font_path, panel.title_size)
    title_box = draw.textbbox((0, 0), panel.title, font=title_font)
    title_width = title_box[2] - title_box[0]
    panel_center = (panel.interior[0] + panel.interior[2]) // 2
    draw.text((panel_center - title_width // 2, panel.title_y), panel.title, font=title_font, fill=ink)

    by_number = {int(entry["number"]): entry for entry in entries}
    for column in panel.columns:
        x0, _, x1, _ = column.box
        y = panel.list_y
        max_width = x1 - x0 - 8
        for number in column.numbers:
            entry = by_number[number]
            meta = str(entry["meta"])
            line = f"{panel.code}{number}: {entry['name']}"
            if meta:
                line += f"（{meta}）"
            font = fit_text(draw, line, body_font_path, panel.body_size, max_width)
            draw.text((x0, y), line, font=font, fill=ink)
            y += panel.line_height


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--translations", type=Path)
    args = parser.parse_args()

    image = Image.open(args.source).convert("RGB")
    if image.size != (6000, 5200):
        raise SystemExit(f"Expected 6000x5200 source, got {image.size[0]}x{image.size[1]}")

    translations = translated_entries(image)
    if args.translations:
        args.translations.write_text(json.dumps(translations, ensure_ascii=False, indent=2), encoding="utf-8")

    title_font_path = "/System/Library/Fonts/Supplemental/Songti.ttc"
    body_font_path = "/System/Library/Fonts/STHeiti Light.ttc"
    for panel in PANELS:
        render_panel(image, panel, translations[panel.key], title_font_path, body_font_path)

    image.save(args.output, format="PNG", optimize=True)
    print(args.output)


if __name__ == "__main__":
    main()

"""Build 施特拉德的诅咒（重置版 v2） from the user's local 重置v2 notes and the original Strahd data (原版/).
python3 scripts/build-strahd-remix.py /path/to/施特拉德的诅咒
shared/strahd-remix/plan.json (hand-written) picks the maps, the v2 sections shown as scene notes and
area notes, and the default encounter groups; cards.json holds the reconstruction's own cards. Maps are
the original PNGs copied byte-for-byte under map-cosr-* ids. Re-running after editing the v2 notes
refreshes scenes.json, index.json and output/strahd-remix/manifest.json. Each scene's `rooms` names the
book chapter and the room codes on its map; those rooms follow the v2 areas, each headed by its 房间描述
entry, else what v2 says about it (or that v2 leaves it empty), and then the original chapter text.
"""
from pathlib import Path
import json, re, sys, hashlib, math, shutil, struct

ROOT = Path(sys.argv[1]); V2 = ROOT / '重置v2'; BOOK = ROOT / '原版'; REPO = Path(__file__).resolve().parents[1]
DATA = REPO / 'shared/strahd-remix'; OUT = REPO / 'output/strahd-remix'; ASSETS = OUT / 'assets'
SOURCE = '施特拉德的诅咒（重置版 v2）'
ident = lambda s: hashlib.sha256(s.encode()).hexdigest()[:12]
plan = json.loads((DATA / 'plan.json').read_text())
own = json.loads((DATA / 'cards.json').read_text())
base_index = json.loads((REPO / 'shared/strahd/index.json').read_text())
originals = {e['key']: e for s in json.loads((REPO / 'shared/strahd/scenes.json').read_text()) for e in s['encounters']}
maps = {p.name[:2]: p for p in (BOOK / '05-地图').glob('*/*.png')}

def initiative(card):
    dex = next((v for k, v in card['campaignCard']['rows'] if k == '敏捷'), None)
    return math.floor((int(dex.split('（')[0]) - 10) / 2) if dex else None

index = {r['id']: {**r, 'chapters': [], 'sceneKeys': []} for r in base_index}
for c in own:
    index[c['id']] = {'id': c['id'], 'type': 'monster', 'nameZh': c['name'], 'nameEn': c['nameEn'], 'source': SOURCE,
                      'bookFile': 'builtin/strahd-remix', 'cr': c['cr'], 'hp': c['hp']['average'] if c['hp'] else None,
                      'initiativeBonus': initiative(c), 'role': c['role'], 'aliases': c['aliases'], 'chapters': [], 'sceneKeys': []}

# ---- markdown → the plain text the DM panel shows (pre-wrap) ----
def plain(lines):
    out, fence = [], False
    for line in lines:
        if line.startswith('```'): fence = not fence; continue
        if fence or re.match(r'^\|\s*-{3}', line) or line.startswith('<!--'): continue
        line = re.sub(r'!\[[^]]*\]\([^)]*\)', '', line)
        line = re.sub(r'\[([^]]+)\]\([^)]*\)', r'\1', line).replace('**', '').replace('`', '')
        if m := re.match(r'^(#+)\s+(.*)', line): line = f'【{m[2].strip()}】'
        elif line.startswith('|'): line = '｜'.join(c.strip() for c in line.strip().strip('|').split('|'))
        elif line.startswith('>'): line = '　' + line[1:].strip() if line[1:].strip() else ''
        elif re.match(r'^\s*- ', line): line = re.sub(r'^(\s*)- ', r'\1· ', line)
        out.append(line.rstrip())
    return re.sub(r'\n{3,}', '\n\n', '\n'.join(out)).strip()

def level(line):
    m = re.match(r'^(#+)\s', line); return len(m[1]) if m else 0

def v2_lines_of(path):
    """A v2 file without the 房间描述 copies embedded in the handbooks; those go to the map rooms once."""
    lines, out, embedded = path.read_text().splitlines(), [], False
    for line in lines:
        if line.startswith('<!-- 内嵌描述'): embedded = '开始' in line; continue
        if not embedded: out.append(line)
    return out

def section(spec):
    """(heading text, body lines) for one plan entry: a whole file, or one heading with its subsections."""
    lines = v2_lines_of(V2 / spec['file'])
    if spec['heading'] is None:
        start = next(i for i, l in enumerate(lines) if l.startswith('# ')) + 1
        end = next((i for i, l in enumerate(lines) if spec.get('until') and l.startswith(spec['until'])), len(lines))
        return None, lines[start:end]
    hits = [i for i, l in enumerate(lines) if l.startswith(spec['heading'])]
    if not hits:
        if spec.get('optional'): return None
        raise SystemExit(f"{spec['file']}: heading not found: {spec['heading']}")
    i, n = hits[0], level(lines[hits[0]])
    end = next((j for j in range(i + 1, len(lines)) if 0 < level(lines[j]) <= n), len(lines))
    return re.sub(r'^#+\s*', '', lines[i]).strip(), lines[i + 1:end]

def label(spec):
    name = Path(spec['file']).name
    m = re.match(r'^([SL]\d)_', name)
    return m[1] if m else spec.get('name') or Path(name).stem.split('_', 1)[-1]

def areas(specs):
    for spec in specs:
        got = section(spec)
        if got is None: continue
        heading, body = got
        if spec.get('expand'):
            n = level('#' * (len(spec['heading']) - len(spec['heading'].lstrip('#'))) + ' ')
            for j, l in enumerate(body):
                if level(l) == n + 1:
                    yield from areas([{'file': spec['file'], 'heading': l}])
            continue
        title = f"{label(spec)} · {heading}" if heading else spec.get('name') or label(spec)
        yield {'name': title, 'text': plain(body)}

def notes(specs):
    parts = []
    for spec in specs:
        got = section(spec)
        if got is None: continue
        heading, body = got
        parts.append((f'【{label(spec)} · {heading}】\n' if heading else '') + plain(body))
    return '\n\n'.join(p for p in parts if p.strip())

# ---- room-by-room areas: the original book text per map room, headed by how v2 uses the room ----
ROOM = re.compile(r'^###\s*(?:([A-Z]{1,2}\d+[a-z]?|\d+[a-z]?)\s*[.．:：、]?|([A-Z])\s*[.．])\s*(\S.*)$')
# Headings that open a new part of the chapter rather than continuing the room above them.
STOP = re.compile(r'特殊事件|各区域|Areas [Oo]f|结局|Endings|Main Floor|Court of the Count|Rooms of Weeping|Spires of|Larders of|Dungeon and Catacombs|地理特征|Walls of')
PAGE = re.compile(r'^(<a id=|\[对照原页\]|本页为地图或插画页|!\[)')

def book_rooms(chapter):
    lines = (BOOK / '01-章节与场景' / chapter / '正文.md').read_text().splitlines()
    start = next((i for i, l in enumerate(lines) if l.startswith('## 原版参考正文')), -1)
    rooms, cur = [], None
    for line in lines[start + 1:]:
        if line.startswith('## PDF第') or PAGE.match(line): continue
        if line.startswith('#'):
            m = ROOM.match(line)
            if m:
                code = m[1] or m[2]; title = re.sub(r'\s+[A-Za-z’\'“].*$', '', m[3]).strip()
                cur = {'code': code, 'title': title, 'body': []}; rooms.append(cur); continue
            if line.startswith('## ') or STOP.search(line): cur = None; continue
        if cur: cur['body'].append(line)
    return rooms

def code_parts(code):
    m = re.match(r'^([A-Z]*)(\d*)([a-z]?)$', code); return m[1], int(m[2]) if m[2] else None, m[3]

def wanted(code, specs):
    prefix, num, sub = code_parts(code)
    for spec in specs:
        top = spec.endswith('.'); lo, _, hi = spec.rstrip('.').partition('-'); hi = hi or lo
        if num is None:
            if lo.isalpha() and len(code) == 1 and lo <= code <= hi: return True
            continue
        lp, ln, _ = code_parts(lo); hp, hn, _ = code_parts(hi)
        if prefix == lp and ln is not None and ln <= num <= hn and not (top and sub): return True
    return False

# NPC cards and maintenance notes are not session text; the room descriptions are placed whole below.
v2_lines = [(label({'file': str(f.relative_to(V2))}), line) for f in sorted(V2.rglob('*.md'))
            if f.relative_to(V2).parts[0] not in ('03-NPC与阵营', '99-维护工具', '房间描述') for line in v2_lines_of(f)]

# ---- 房间描述 R0—R8: one entry per `## CODE 名称`, sent to a scene by plan.json (`by` overrides the file's scene) ----
def descriptions():
    placed = {}
    for spec in plan['descriptions']:
        lines, tag = (V2 / spec['file']).read_text().splitlines(), Path(spec['file']).name[:2]
        heads = [i for i, l in enumerate(lines) if re.match(r'^## \S+ \S', l) and not l.startswith('## 房间索引')]
        for i in heads:
            code, title = lines[i][3:].split(' ', 1)
            end = next((j for j in range(i + 1, len(lines)) if lines[j].startswith('## ') or lines[j] == '---'), len(lines))
            m = re.match(r'^([A-Z]*)(\d*)', code)
            scene = next((spec['by'][k] for k in (code, code.split('-')[0], m[0], m[1]) if k in spec.get('by', {})), spec['scene'])
            room = re.sub(r'^DH(?=\d)', '', code)  # 死亡之屋 rooms are bare numbers in the book
            name = f'{tag} · {title}' if '-' in code or room != code else f'{tag} · {code} {title}'
            placed.setdefault(scene, []).append({'room': room, 'name': name, 'text': plain(lines[i + 1:end])})
    return placed

CODE_RANGE = re.compile(r'(?<![A-Za-z0-9])([A-Z]{1,2})(\d+)\s*[—–-]+\s*\1?(\d+)(?![0-9a-z])')  # K7—K10
AREA_RANGE = re.compile(r'区域\s*([A-Z]|\d+)\s*[—–-]+\s*([A-Z]|\d+)')  # 区域 A—C

def mentions(line, code, title):
    """Whether a v2 line points at this room. Bare letters and numbers only count after 区域, and S codes
    (which collide with the v2 session labels S1—S8) only when followed by the room's own name."""
    prefix, num, _ = code_parts(code)
    if not prefix or (num is None):
        if re.search(rf'区域\s*{code}(?![0-9a-z])', line): return True
        for lo, hi in AREA_RANGE.findall(line):
            if lo.isdigit() == code.isdigit() and lo.isdigit() == hi.isdigit():
                if (int(lo) <= int(code) <= int(hi)) if code.isdigit() else (lo <= code <= hi): return True
        return False
    if prefix == 'S': return bool(re.search(rf'(?<![A-Za-z0-9]){code}\s*{re.escape(title[:2])}', line))
    if re.search(rf'(?<![A-Za-z0-9]){code}(?![0-9a-z])', line): return True
    return any(p == prefix and int(lo) <= num <= int(hi) for p, lo, hi in CODE_RANGE.findall(line))

def clip(text, n=240): return text if len(text) <= n else text[:n] + '…'

def room_areas(spec, encounters, described):
    for room in book_rooms(spec['file']):
        code, title = room['code'], room['title']
        if not wanted(code, spec['codes']): continue
        notes, seen = [], set()
        for e in encounters:
            if re.search(rf'(?<![A-Za-z0-9]){code}(?![0-9a-z])', e['region']):
                notes.append(f"· 预置 {e['name']} ×{e['count']}" if e['automatic'] else f"· 按触发加入：{e['name']}（{e['quantity']}）")
        if code in described:
            notes.append(described[code])
        else:
            for source, line in v2_lines:
                if not mentions(line, code, title): continue
                text = plain([line]).strip('·【】 ')
                if text and text not in seen:
                    seen.add(text); notes.append(f'· {source}：{clip(text)}')
            notes = notes[:8]
        head = '【重置版】\n' + '\n'.join(notes) if notes else '【重置版】v2 没有安排这里：默认不刷敌人或陷阱，按下面的原版描述空间即可。'
        yield {'key': code, 'name': title if code.isdigit() else f'{code} {title}',
               'text': f"{head}\n\n【原版】\n{plain(room['body'])}"}

# ---- scenes ----
ASSETS.mkdir(parents=True, exist_ok=True)
for old in ASSETS.iterdir(): old.unlink()
scenes, placed = [], descriptions()
for p in plan['scenes']:
    img = maps[p['map']]; data = img.read_bytes()
    width, height = struct.unpack('>II', data[16:24])
    asset = f"map-cosr-{p['map']}-{hashlib.sha256(data).hexdigest()[:12]}"
    shutil.copyfile(img, ASSETS / asset)
    encounters, keys = [], set()
    for spec in p['encounters']:
        if 'keep' in spec:
            o = originals[spec['keep']]
            e = {k: o[k] for k in ('entryId', 'name', 'section', 'region', 'quantity', 'count', 'hp', 'initiativeBonus', 'condition', 'source', 'position', 'automatic')}
        else:
            row = index[spec['card']]
            e = {'entryId': row['id'], 'name': row['nameZh'], 'section': spec['section'], 'region': spec['region'],
                 'quantity': spec['quantity'], 'count': spec['count'], 'hp': row['hp'], 'initiativeBonus': row['initiativeBonus'],
                 'condition': spec['condition'], 'source': spec['source'],
                 'position': originals[spec['at']]['position'] if 'at' in spec else None, 'automatic': spec['automatic']}
            if 'currentHp' in spec: e['currentHp'] = spec['currentHp']
        e['key'] = f"{p['key']}-{ident(e['section'] + e['region'] + e['entryId'])}"
        assert e['key'] not in keys, e['key']; keys.add(e['key'])
        assert not e['automatic'] or (e['count'] and e['position']), (p['key'], e['region'])
        encounters.append(e)
        row = index[e['entryId']]
        if p['chapter'] not in row['chapters']: row['chapters'].append(p['chapter'])
        if p['key'] not in row['sceneKeys']: row['sceneKeys'].append(p['key'])
    rooms = {r['code'] for r in book_rooms(p['rooms']['file']) if wanted(r['code'], p['rooms']['codes'])}
    entries = placed.pop(p['key'], [])
    described = {d['room']: d['text'] for d in entries if d['room'] in rooms}
    extra = [{'name': d['name'], 'text': d['text']} for d in entries if d['room'] not in rooms]
    scenes.append({'key': p['key'], 'name': f"{p['key']} · {p['name']}", 'chapter': p['chapter'],
                   'map': {'assetId': asset, 'width': width, 'height': height, 'mapScale': 3},
                   'encounters': encounters, 'notes': notes(p['notes']),
                   'areas': [{'key': f'a{i + 1:02d}', **a} for i, a in enumerate([*areas(p['areas']), *extra])]
                            + list(room_areas(p['rooms'], encounters, described))})
    assert len({a['key'] for a in scenes[-1]['areas']}) == len(scenes[-1]['areas']), p['key']
assert not placed, f'房间描述 sent to unknown scenes: {list(placed)}'

(DATA / 'scenes.json').write_text(json.dumps(scenes, ensure_ascii=False, indent=2) + '\n')
(DATA / 'index.json').write_text(json.dumps(list(index.values()), ensure_ascii=False, indent=2) + '\n')
manifest = {'id': 'curse-of-strahd-remix', 'schemaVersion': 1, 'scenes': [{'key': s['key'], 'name': s['name'], 'map': s['map']} for s in scenes]}
(OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
tokens = sum(e['count'] for s in scenes for e in s['encounters'] if e['automatic'])
print(f"{SOURCE}: {len(scenes)} maps, {len(own)} own cards, {sum(len(s['encounters']) for s in scenes)} encounters, "
      f"{tokens} preset tokens, {sum(len(s['areas']) for s in scenes)} areas")

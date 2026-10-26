"""Build 施特拉德的诅咒（重置版 v2） from the user's local 重置版v2 notes and the original Strahd data.
python3 scripts/build-strahd-remix.py /path/to/施特拉德的诅咒
shared/strahd-remix/plan.json (hand-written) picks the maps, the v2 sections shown as scene notes and
area notes, and the default encounter groups; cards.json holds the reconstruction's own cards. Maps are
the original PNGs copied byte-for-byte under map-cosr-* ids. Re-running after editing the v2 notes
refreshes scenes.json, index.json and output/strahd-remix/manifest.json.
"""
from pathlib import Path
import json, re, sys, hashlib, math, shutil, struct

ROOT = Path(sys.argv[1]); V2 = ROOT / '重置版v2'; REPO = Path(__file__).resolve().parents[1]
DATA = REPO / 'shared/strahd-remix'; OUT = REPO / 'output/strahd-remix'; ASSETS = OUT / 'assets'
SOURCE = '施特拉德的诅咒（重置版 v2）'
ident = lambda s: hashlib.sha256(s.encode()).hexdigest()[:12]
plan = json.loads((DATA / 'plan.json').read_text())
own = json.loads((DATA / 'cards.json').read_text())
base_index = json.loads((REPO / 'shared/strahd/index.json').read_text())
originals = {e['key']: e for s in json.loads((REPO / 'shared/strahd/scenes.json').read_text()) for e in s['encounters']}
maps = {p.name[:2]: p for p in (ROOT / '地图').glob('*/*.png')}

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

def section(spec):
    """(heading text, body lines) for one plan entry: a whole file, or one heading with its subsections."""
    lines = (V2 / spec['file']).read_text().splitlines()
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

# ---- scenes ----
ASSETS.mkdir(parents=True, exist_ok=True)
for old in ASSETS.iterdir(): old.unlink()
scenes = []
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
    scenes.append({'key': p['key'], 'name': f"{p['key']} · {p['name']}", 'chapter': p['chapter'],
                   'map': {'assetId': asset, 'width': width, 'height': height, 'mapScale': 3},
                   'encounters': encounters, 'notes': notes(p['notes']),
                   'areas': [{'key': f'a{i + 1:02d}', **a} for i, a in enumerate(areas(p['areas']))]})

(DATA / 'scenes.json').write_text(json.dumps(scenes, ensure_ascii=False, indent=2) + '\n')
(DATA / 'index.json').write_text(json.dumps(list(index.values()), ensure_ascii=False, indent=2) + '\n')
manifest = {'id': 'curse-of-strahd-remix', 'schemaVersion': 1, 'scenes': [{'key': s['key'], 'name': s['name'], 'map': s['map']} for s in scenes]}
(OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
tokens = sum(e['count'] for s in scenes for e in s['encounters'] if e['automatic'])
print(f"{SOURCE}: {len(scenes)} maps, {len(own)} own cards, {sum(len(s['encounters']) for s in scenes)} encounters, "
      f"{tokens} preset tokens, {sum(len(s['areas']) for s in scenes)} areas")

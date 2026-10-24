"""Build Lost Mine of Phandelver from the local translated PDF and the checked-in scene presets.
python3 scripts/build-phandelver.py /path/to/凡戴尔的失落矿坑
Maps are extracted byte-for-byte with poppler's pdfimages; cards and scene notes are hand-checked
data in shared/phandelver/. Re-running is idempotent: it refreshes map metadata, derived encounter
fields, index.json and output/phandelver/manifest.json.
"""
from pathlib import Path
import json, sys, hashlib, math, shutil, subprocess, tempfile

ROOT = Path(sys.argv[1]); REPO = Path(__file__).resolve().parents[1]
DATA = REPO / 'shared/phandelver'; OUT = REPO / 'output/phandelver'; ASSETS = OUT / 'assets'
pdf = ROOT if ROOT.suffix == '.pdf' else next(ROOT.glob('*凡戴尔的失落矿坑*.pdf'))
cards = json.loads((DATA / 'cards.json').read_text())
scenes = json.loads((DATA / 'scenes.json').read_text())
by_id = {c['id']: c for c in cards}
ident = lambda s: hashlib.sha256(s.encode()).hexdigest()[:12]
SCALE = {'tiny': 0.5, 'small': 1, 'medium': 1, 'large': 2}

def jpeg_size(data: bytes):
    i = 2
    while i < len(data):
        marker, length = data[i + 1], int.from_bytes(data[i + 2:i + 4], 'big')
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            return int.from_bytes(data[i + 7:i + 9], 'big'), int.from_bytes(data[i + 5:i + 7], 'big')
        i += 2 + length
    raise ValueError('not a JPEG')

def initiative(card):
    dex = next((v for k, v in card['campaignCard']['rows'] if k == '敏捷'), None)
    return math.floor((int(dex.split('（')[0]) - 10) / 2) if dex else None

ASSETS.mkdir(parents=True, exist_ok=True)
for old in ASSETS.iterdir(): old.unlink()
with tempfile.TemporaryDirectory() as tmp:
    for s in scenes:
        page = s['sourcePage']
        subprocess.run(['pdfimages', '-j', '-f', str(page), '-l', str(page), str(pdf), f'{tmp}/p{page}'], check=True)
        # Each map page holds exactly one full-page map image; keep the largest original stream.
        image = max(Path(tmp).glob(f'p{page}-*'), key=lambda p: p.stat().st_size)
        data = image.read_bytes()
        assert image.suffix == '.jpg', f'page {page}: expected a JPEG map, got {image.name}'
        width, height = jpeg_size(data)
        asset = f"map-lmop-{s['key']}-{hashlib.sha256(data).hexdigest()[:12]}"
        shutil.copyfile(image, ASSETS / asset)
        s['map'].update(assetId=asset, width=width, height=height)

index = {c['id']: {'id': c['id'], 'type': 'monster', 'nameZh': c['name'], 'nameEn': c['nameEn'], 'source': '凡戴尔的失落矿坑',
                   'bookFile': 'builtin/phandelver', 'cr': c['cr'], 'hp': c['hp']['average'] if c['hp'] else None,
                   'initiativeBonus': initiative(c) if c['hp'] else None, 'role': c['role'], 'aliases': c['aliases'],
                   'chapters': [], 'sceneKeys': []} for c in cards}
for s in scenes:
    assert s['tokenSize'] > 0 and s['map']['mapScale'] > 0
    keys = set()
    for e in s['encounters']:
        card = by_id[e['entryId']]
        e['key'] = f"{s['key']}-{ident(e['section'] + e['region'] + e['entryId'])}"
        assert e['key'] not in keys, e['key']; keys.add(e['key'])
        e['name'] = card['name']
        e['hp'] = card['hp']['average'] if card['hp'] else None
        e['initiativeBonus'] = index[card['id']]['initiativeBonus']
        e['tokenScale'] = SCALE[card['size']]
        if e['position'] is not None: assert all(0 <= v <= 1 for v in e['position']), (s['key'], e['region'])
        assert not e['automatic'] or (e['count'] and e['position']), (s['key'], e['region'])
        row = index[card['id']]
        if s['chapter'] not in row['chapters']: row['chapters'].append(s['chapter'])
        if s['key'] not in row['sceneKeys']: row['sceneKeys'].append(s['key'])

(DATA / 'scenes.json').write_text(json.dumps(scenes, ensure_ascii=False, indent=2) + '\n')
(DATA / 'index.json').write_text(json.dumps(list(index.values()), ensure_ascii=False, indent=2) + '\n')
manifest = {'id': 'lost-mine-of-phandelver', 'schemaVersion': 1,
            'scenes': [{'key': s['key'], 'name': s['name'], 'map': s['map']} for s in scenes]}
(OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
tokens = sum(e['count'] for s in scenes for e in s['encounters'] if e['automatic'])
print(f'{len(scenes)} maps, {len(cards)} cards, {sum(len(s["encounters"]) for s in scenes)} encounters, {tokens} preset tokens')

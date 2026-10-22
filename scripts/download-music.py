"""Download the explicitly licensed music catalog; preserve original MP3 bytes."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
tracks = json.loads((root / 'client/src/music/hosted.json').read_text())

def download(track):
    target = root / 'client/public' / track['audio'].lstrip('/')
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        temporary = target.with_suffix('.download')
        subprocess.run(['curl', '-fL', '--retry', '3', '--max-time', '180', '-sS', track['downloadUrl'], '-o', str(temporary)], check=True)
        temporary.rename(target)
    metadata = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(target)]))
    assert any(s.get('codec_type') == 'audio' for s in metadata['streams']), track['title']
    assert target.stat().st_size < 25 * 1024 * 1024, 'Cloudflare static asset limit'
    return {**track, 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'seconds': float(metadata['format']['duration'])}

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    manifest = list(pool.map(download, tracks))
(root / 'client/public/music/credits.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(f'Verified {len(manifest)} audio files, {sum(t["bytes"] for t in manifest) / 1024 / 1024:.1f} MiB')

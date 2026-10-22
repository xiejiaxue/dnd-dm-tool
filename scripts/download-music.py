"""Download the explicitly licensed music catalog; preserve original MP3 bytes."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
tracks = json.loads((root / 'client/src/music/hosted.json').read_text())
credits = {track['id']: track for track in json.loads((root / 'client/public/music/credits.json').read_text())}

def download(track):
    target = root / 'client/public' / track['audio'].lstrip('/')
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        temporary = target.with_suffix('.download')
        subprocess.run(['curl', '-fL', '--retry', '3', '--max-time', '180', '-sS', track['downloadUrl'], '-o', str(temporary)], check=True)
        temporary.rename(target)
    expected = credits[track['id']]
    assert all(expected.get(k) == v for k, v in track.items()), 'Music catalog differs from pinned credits'
    assert target.stat().st_size == expected['bytes'], 'Unexpected audio size: ' + str(target)
    assert hashlib.sha256(target.read_bytes()).hexdigest() == expected['sha256'], 'Audio checksum mismatch: ' + str(target)
    # The checked-in hashes pin the previously decoded and verified recordings.
    # Exact bytes need no platform-specific decoder at every release.
    assert target.stat().st_size < 25 * 1024 * 1024, 'Cloudflare static asset limit'
    return expected

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    manifest = list(pool.map(download, tracks))
# credits.json is the reviewed, pinned checksum manifest; releases never rewrite it.
print(f'Verified {len(manifest)} audio files, {sum(t["bytes"] for t in manifest) / 1024 / 1024:.1f} MiB')

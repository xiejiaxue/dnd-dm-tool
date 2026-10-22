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
    expected = credits[track['id']]
    assert all(expected.get(k) == v for k, v in track.items()), 'Music catalog differs from pinned credits'
    if not target.exists():
        temporary = target.with_suffix('.download')
        mirror = 'https://github.com/xiejiaxue/dnd-dm-tool/releases/download/music-assets-20261022/' + target.name
        for source in [mirror, track['downloadUrl']]:
            result = subprocess.run(['curl', '-fL', '--retry', '2', '--retry-all-errors', '--connect-timeout', '15', '--max-time', '90', '-sS', source, '-o', str(temporary)])
            if result.returncode != 0:
                temporary.unlink(missing_ok=True)
                continue
            assert temporary.stat().st_size == expected['bytes'], 'Downloaded audio size mismatch: ' + target.name
            assert hashlib.sha256(temporary.read_bytes()).hexdigest() == expected['sha256'], 'Downloaded audio checksum mismatch: ' + target.name
            temporary.rename(target)
            break
        else:
            raise RuntimeError('Could not download verified audio: ' + target.name)
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

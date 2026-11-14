"""Repack verified runtime resources without changing the WASM or font library.

The output contains only changed resource files. Serve other engine files from
the pinned input package. Profiles are experiments until browser checks pass.
"""
import argparse
import gzip
import hashlib
import json
import struct
import shutil
import zlib
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--profile', required=True, choices=['ui-pruned', 'lazy-fonts', 'combined'])
args = parser.parse_args()
source, output = args.source.resolve(), args.output.resolve()
if output == source or source in output.parents:
    raise ValueError('Keep variant output separate from the input artifact')
if output.exists() and any(output.iterdir()):
    raise ValueError('Output must be empty; never overwrite a measured variant')
output.mkdir(parents=True, exist_ok=True)
metadata = json.loads((source / 'soffice.data.js.metadata').read_text())
data = (source / 'soffice.data').read_bytes()
pack = (source / 'soffice.lazy').read_bytes()
if pack[:4] != b'LAZY':
    raise ValueError('Unknown resource pack format')
index_size = struct.unpack_from('<I', pack, 4)[0]
index = json.loads(pack[8:8 + index_size])
pack_start = 8 + index_size
all_paths = set()
eager = []
lazy = []
removed = []
moved = []


def check_path(name):
    if name in all_paths or '..' in name or not name.startswith(('/instdir/', '/android/default-document/')):
        raise ValueError('Unsafe or duplicate resource path: ' + name)
    all_paths.add(name)


def remove(name):
    return args.profile in ['ui-pruned', 'combined'] and (
        'notebookbar' in name or name.startswith('/android/default-document/'))


for entry in metadata['files']:
    name, start, end = entry['filename'], entry['start'], entry['end']
    check_path(name)
    if not 0 <= start <= end <= len(data):
        raise ValueError('Invalid data slice: ' + name)
    blob = data[start:end]
    if remove(name):
        removed.append({'path': name, 'bytes': len(blob)})
    elif args.profile in ['lazy-fonts', 'combined'] and name.lower().endswith(('.ttf', '.otf', '.ttc')):
        compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
        compressed = compressor.compress(blob) + compressor.flush()
        lazy.append((name, len(blob), compressed))
        moved.append({'path': name, 'bytes': len(blob)})
    else:
        eager.append((entry, blob))
for entry in index:
    name, size, offset, length = (entry[k] for k in ['p', 's', 'o', 'n'])
    check_path(name)
    if not 0 <= offset <= offset + length <= len(pack) - pack_start:
        raise ValueError('Invalid compressed resource slice: ' + name)
    if remove(name):
        removed.append({'path': name, 'bytes': size})
    else:
        lazy.append((name, size, pack[pack_start + offset:pack_start + offset + length]))

new_data, files = bytearray(), []
for entry, blob in eager:
    start = len(new_data)
    new_data.extend(blob)
    files.append({**entry, 'start': start, 'end': len(new_data)})
new_index, blobs, offset = [], [], 0
for name, size, blob in lazy:
    new_index.append({'p': name, 'o': offset, 'n': len(blob), 's': size})
    blobs.append(blob)
    offset += len(blob)
encoded_index = json.dumps(new_index, separators=(',', ':')).encode()
new_pack = b'LAZY' + struct.pack('<I', len(encoded_index)) + encoded_index + b''.join(blobs)
artifacts = {
    'soffice.data': bytes(new_data),
    'soffice.data.js.metadata': json.dumps({**metadata, 'files': files,
                                         'remote_package_size': len(new_data)}, separators=(',', ':')).encode(),
    'soffice.lazy': new_pack,
}
manifest = {'profile': args.profile, 'source': {}, 'artifacts': {}, 'removed': removed,
            'movedToCompressedLazyPack': moved, 'fontsDeleted': 0,
            'browserQualified': False}
for name in ['soffice.js', 'soffice.wasm', 'soffice.data', 'soffice.data.js.metadata', 'soffice.lazy']:
    path = source / name
    manifest['source'][name] = {'bytes': path.stat().st_size,
                              'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
for name, blob in artifacts.items():
    (output / name).write_bytes(blob)
    reuse = not name.endswith('.lazy') and (source / (name + '.gz')).exists() and blob == (source / name).read_bytes()
    wire = blob if name.endswith('.lazy') else (source / (name + '.gz')).read_bytes() if reuse else gzip.compress(blob, compresslevel=9, mtime=0)
    if not name.endswith('.lazy'):
        if reuse:
            shutil.copy2(source / (name + '.gz'), output / (name + '.gz'))
        else:
            (output / (name + '.gz')).write_bytes(wire)
    manifest['artifacts'][name] = {'bytes': len(blob), 'transferBytes': len(wire),
                                  'compressedInputReused': reuse,
                                  'sha256': hashlib.sha256(blob).hexdigest()}
(output / 'variant.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({k: v for k, v in manifest.items() if k not in ['removed', 'movedToCompressedLazyPack']}, indent=2))

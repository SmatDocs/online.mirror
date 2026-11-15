"""Record build identity and artifact hashes without environment secrets."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

work, recipe = map(Path, sys.argv[1:3])
variant = sys.argv[3] if len(sys.argv) > 3 else 'writer-only'
if variant not in ['writer-only', 'full-fonts']:
    raise ValueError('Unknown build variant')
full_fonts = variant == 'full-fonts'
folders = ['raw-full-fonts', 'packed-full-fonts'] if full_fonts else ['raw', 'packed']
manifest_name = 'manifest-full-fonts.json' if full_fonts else 'manifest.json'


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


manifest = {
    'experimental': True,
    'profile': 'full applications with portable font registration' if full_fonts else 'writer-only baseline; optional patches not applied',
    'applications': ['writer', 'calc', 'impress'] if full_fonts else ['writer'],
    'core': subprocess.check_output(['git', '-C', str(work / 'core'), 'rev-parse', 'HEAD'], text=True).strip(),
    'emsdk': subprocess.check_output(['git', '-C', str(work / 'sdk'), 'rev-parse', 'HEAD'], text=True).strip(),
    'configure': (work / 'core/autogen.input').read_text().splitlines(),
    'recipeFiles': {},
    'artifacts': {},
}
source_diff = subprocess.check_output(['git', '-C', str(work / 'core'), 'diff', '--binary'])
manifest['sourceDiffSha256'] = hashlib.sha256(source_diff).hexdigest()
manifest['sourceDiffFiles'] = subprocess.check_output(
    ['git', '-C', str(work / 'core'), 'diff', '--name-only'], text=True).splitlines()
manifest['appliedPatches'] = ['reference-build/lo-source.patch'] + [
    str(path.relative_to(recipe)) for path in sorted((recipe / 'reference-build/patches').glob('*.patch'))]
if full_fonts:
    manifest['appliedPatches'].append('portable-font-registration.patch')
manifest['optionalRecipePatchesNotApplied'] = [path.name for path in sorted(recipe.glob('*.patch'))
    if path.name not in manifest['appliedPatches']]
for path in sorted(recipe.rglob('*')):
    if path.is_file():
        manifest['recipeFiles'][str(path.relative_to(recipe))] = digest(path)
for folder in folders:
    for path in sorted((work / folder).iterdir()):
        if path.is_file():
            manifest['artifacts'][str(path.relative_to(work))] = {
                'bytes': path.stat().st_size, 'sha256': digest(path),
            }
(work / manifest_name).write_text(json.dumps(manifest, indent=2) + '\n')

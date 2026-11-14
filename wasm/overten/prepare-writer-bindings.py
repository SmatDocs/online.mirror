"""Prepare a Writer-focused primary IDL tree for a separate bridge experiment.

Default to Writer API families, or use observed protocol seeds plus UDK and
bootstrap types. Recursively restore their dependencies. Complete RDBs remain
secondary lookup providers. This does not modify the running core build.
"""
import argparse
import json
import re
import shutil
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--core', required=True, type=Path)
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--seeds', type=Path, help='Optional JSON list of observed bridge converter names')
args = parser.parse_args()
core, output = args.core.resolve(), args.output.resolve()
if output.exists() and any(output.iterdir()):
    raise ValueError('Use an empty output directory')
catalog = {}
for api in ['udkapi', 'offapi']:
    for path in (core / api / 'com').rglob('*.idl'):
        relative = path.relative_to(core / api)
        catalog[str(relative)] = (api, path)
excluded = {'sheet', 'presentation', 'sdb', 'sdbc', 'sdbcx', 'report', 'deployment'}
if args.seeds:
    seeds = {'com.sun.star.configuration.ReadWriteAccess', 'com.sun.star.frame.XModel',
             'com.sun.star.awt.FontSlant', 'com.sun.star.beans.PropertyValue'}
    for name in json.loads(args.seeds.read_text()):
        if isinstance(name, str):
            normalized = name.replace('::', '.').replace('$', '.')
            seeds.update(re.findall(r'com\.sun\.star\.[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*', normalized))
    selected = {name for name, (api, _) in catalog.items() if api == 'udkapi'}
    unknown = []
    for name in seeds:
        path = name.replace('.', '/') + '.idl'
        if path in catalog:
            selected.add(path)
        else:
            unknown.append(name)
    if unknown:
        raise ValueError('Unresolved IDL seeds: ' + ', '.join(sorted(unknown)))
else:
    selected = {name for name, (api, _) in catalog.items()
                if api == 'udkapi' or Path(name).parts[3] not in excluded}
initial = set(selected)
queue = list(selected)
while queue:
    name = queue.pop()
    text = catalog[name][1].read_text()
    text = re.sub(r'/\*.*?\*/|//[^\n]*', '', text, flags=re.S)
    references = re.findall(r'#\s*include\s*[<"]([^>"]+\.idl)[>"]', text)
    references += [match.replace('::', '/') + '.idl'
                   for match in re.findall(r'com::sun::star::[A-Za-z0-9_:]+', text)]
    parent = Path(name).parent
    references += [str(parent / (token + '.idl'))
                   for token in set(re.findall(r'\b[A-Z][A-Za-z0-9_]*\b', text))]
    for reference in references:
        if reference in catalog and reference not in selected:
            selected.add(reference)
            queue.append(reference)
output.mkdir(parents=True, exist_ok=True)
for name in sorted(selected):
    target = output / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(catalog[name][1], target)
manifest = {
    'experimental': True, 'totalTypes': len(catalog), 'initialTypes': len(initial),
    'selectedTypes': len(selected), 'restoredDependencies': sorted(selected - initial),
    'excludedFamilies': sorted(excluded), 'omittedTypes': sorted(set(catalog) - selected),
    'runtimeQualified': False,
    'scope': 'current Word agent protocol' if args.seeds else 'Writer API families',
}
(output.parent / (output.name + '-manifest.json')).write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({k: v for k, v in manifest.items()
                  if k not in ['restoredDependencies', 'omittedTypes']}, indent=2))

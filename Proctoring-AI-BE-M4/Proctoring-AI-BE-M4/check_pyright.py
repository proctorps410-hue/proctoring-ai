import json
import os

with open('pyright_errors.json', 'r', encoding='utf-16') as f:
    data = json.load(f)

print(f"Total issues: {len(data['generalDiagnostics'])}")

by_file = {}
for diag in data['generalDiagnostics']:
    file = os.path.basename(diag.get('file', 'unknown'))
    if file not in by_file: by_file[file] = []
    by_file[file].append(diag['message'])

for file, msgs in sorted(by_file.items(), key=lambda x: len(x[1]), reverse=True):
    print(f"{file} - {len(msgs)} errors")
    for m in msgs[:2]:
        print(f"  - {m}")
    if len(msgs) > 2:
        print(f"  ... and {len(msgs)-2} more")

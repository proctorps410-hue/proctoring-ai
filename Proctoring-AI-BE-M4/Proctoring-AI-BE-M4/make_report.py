import json
import os

with open('pyright_errors.json', 'r', encoding='utf-16') as f:
    data = json.load(f)

by_file = {}
for diag in data['generalDiagnostics']:
    file = os.path.basename(diag.get('file', 'unknown'))
    if file not in by_file: by_file[file] = []
    by_file[file].append(f"Line {diag['range']['start']['line']+1}: {diag['message']}")

with open('final_errors.txt', 'w', encoding='utf-8') as f:
    f.write(f"Total issues: {len(data['generalDiagnostics'])}\n\n")
    for file, msgs in sorted(by_file.items(), key=lambda x: len(x[1]), reverse=True):
        f.write(f"{file} - {len(msgs)} errors\n")
        # Print all errors because I need to fix them
        for m in msgs:
            f.write(f"  - {m}\n")
        f.write("\n")

import json
import os

with open('pyright_errors.json', 'r', encoding='utf-16') as f:
    data = json.load(f)

lines = []
for diag in data['generalDiagnostics']:
    file = diag.get('file', 'unknown')
    msg = diag['message']
    if 'Invalid conditional operand' in msg or 'Method __bool__' in msg:
        lines.append(f"{os.path.basename(file)}:{diag['range']['start']['line'] + 1}")

with open('pyright_filter_output.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(lines))

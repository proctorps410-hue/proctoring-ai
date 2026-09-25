import json
import os

files = {
    'FE': r'd:\proctoring AI\Proctoring-AI-FE-M4\Proctoring-AI-FE-M4\eslint_report.json',
    'Admin': r'd:\proctoring AI\Proctoring-AI-Admin\eslint_report.json'
}

for name, path in files.items():
    if not os.path.exists(path):
        print(f'{name} JSON not found yet')
        continue
    try:
        with open(path, 'r', encoding='utf-16') as f:
            data = json.load(f)
        total_errors = sum(item['errorCount'] for item in data)
        total_warnings = sum(item['warningCount'] for item in data)
        print(f'{name} ESLint: {total_errors} errors, {total_warnings} warnings')
        if total_errors > 0 or total_warnings > 0:
            for item in data:
                if item['errorCount'] > 0 or item['warningCount'] > 0:
                    print(f"  {os.path.basename(item['filePath'])}: {item['errorCount']}e, {item['warningCount']}w")
    except Exception as e:
        print(f'Error reading {name}: {e}')

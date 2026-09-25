import os
import re

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Match `from "module@version"` replacing with `from "module"`
    # Pattern: capture group 1: `from "` or `import "`, capture group 2: everything except `@` or quote, 
    # except `@` is allowed at the very start of the module string like `@radix-ui`.
    # Let's use a simpler pattern: look for `@` followed by a digit.
    # We can match module string like `@radix-ui/react-accordion@1.2.3` and replace `@1.2.3`
    
    # Matches `@` followed by digits and dots (and optionally hyphens/letters for stuff like `-beta`) right before the closing quote
    pattern = r'(["\'])([@a-zA-Z0-9_\-\/]+)@[0-9]+(?:\.[0-9]+)*[a-zA-Z0-9_\-]*(["\'])'
    new_content = re.sub(pattern, r'\1\2\3', content)

    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Fixed imports in {filepath}")

def walk_dir(directory):
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(('.ts', '.tsx', '.js', '.jsx')):
                process_file(os.path.join(root, file))

if __name__ == '__main__':
    project_dir = r"d:\proctoring AI\Proctoring-AI-Admin\src"
    walk_dir(project_dir)

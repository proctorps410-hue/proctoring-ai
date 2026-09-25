path = r'd:\proctoring AI\Proctoring-AI-BE-M4\Proctoring-AI-BE-M4\config\detection_config.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = ('    # Person detection confidence used as secondary face-absence fallback\n'
       '    person_confidence: float = field(\n'
       '        default_factory=lambda: _float("PROCTOR_YOLO_PERSON_THRESH", 0.55)\n'
       '    )')

new = ('    # Person detection: 0.45 catches partially-visible persons in webcam frame\n'
       '    # (was 0.55 - missed second person who was half in frame)\n'
       '    person_confidence: float = field(\n'
       '        default_factory=lambda: _float("PROCTOR_YOLO_PERSON_THRESH", 0.45)\n'
       '    )')

if old in content:
    content = content.replace(old, new)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('OK - replaced')
else:
    idx = content.find('person_confidence')
    print('NOT FOUND - context:')
    print(repr(content[max(0, idx-150):idx+250]))

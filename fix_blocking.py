import re
import os

# 1. Fix warmup
with open("Proctoring-AI-BE-M4/Proctoring-AI-BE-M4/services/warmup_service.py", "r") as f:
    warmup_code = f.read()

warmup_code = warmup_code.replace("""            await asyncio.to_thread(detect_face_box, frame, user_id=0)
            await asyncio.to_thread(detect_face_mesh, frame, user_id=0)
            await asyncio.to_thread(detect_yolo, frame, confidence_threshold=None, user_id=0)
            await asyncio.to_thread(detect_hands, frame, user_id=0)
            await asyncio.to_thread(detect_gaze, frame, user_id=0)
            await asyncio.to_thread(detect_spoofing, frame, user_id=0)""", """            await asyncio.gather(
                asyncio.to_thread(detect_face_box, frame, user_id=0),
                asyncio.to_thread(detect_face_mesh, frame, user_id=0),
                asyncio.to_thread(detect_yolo, frame, confidence_threshold=None, user_id=0),
                asyncio.to_thread(detect_hands, frame, user_id=0),
                asyncio.to_thread(detect_gaze, frame, user_id=0),
                asyncio.to_thread(detect_spoofing, frame, user_id=0)
            )""")

with open("Proctoring-AI-BE-M4/Proctoring-AI-BE-M4/services/warmup_service.py", "w") as f:
    f.write(warmup_code)

# 2. Fix auth.py
with open("Proctoring-AI-BE-M4/Proctoring-AI-BE-M4/routers/auth.py", "r") as f:
    auth_code = f.read()

if "import asyncio" not in auth_code:
    auth_code = auth_code.replace("from typing import Dict", "import asyncio\nfrom typing import Dict")

auth_code = auth_code.replace("""        analysis = analyze_face_capture(
            pose_image_data,
            target_pose=pose,
            require_pose_match=True,
        )""", """        analysis = await asyncio.to_thread(
            analyze_face_capture,
            pose_image_data,
            target_pose=pose,
            require_pose_match=True,
        )""")

auth_code = auth_code.replace("""    analysis = analyze_face_capture(
        image_data,
        target_pose="front",
        require_pose_match=False,
    )""", """    analysis = await asyncio.to_thread(
        analyze_face_capture,
        image_data,
        target_pose="front",
        require_pose_match=False,
    )""")

auth_code = auth_code.replace("""    try:
        _enforce_enrolled_face_match(enrolled_references, fresh_reference_payloads)
    except HTTPException:""", """    try:
        await asyncio.to_thread(_enforce_enrolled_face_match, enrolled_references, fresh_reference_payloads)
    except HTTPException:""")

auth_code = auth_code.replace("""    analysis = analyze_face_capture(image_data, target_pose=pose, require_pose_match=require_pose_match)""", """    analysis = await asyncio.to_thread(analyze_face_capture, image_data, target_pose=pose, require_pose_match=require_pose_match)""")

with open("Proctoring-AI-BE-M4/Proctoring-AI-BE-M4/routers/auth.py", "w") as f:
    f.write(auth_code)

print("Fixes applied successfully!")

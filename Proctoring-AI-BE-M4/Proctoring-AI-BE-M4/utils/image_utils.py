import base64
import cv2
import numpy as np
from utils.logger import logger
import re
import io
from PIL import Image
from typing import Optional, Any

def clean_base64_string(data: str) -> Optional[str]:
    """Clean and validate base64 string"""
    try:
        # Remove all whitespace and newlines
        data = ''.join(data.split())
        
        # Extract base64 data from data URL
        if 'base64,' in data:
            data = data.split('base64,')[1]
            
        # Remove any invalid characters
        data = re.sub(r'[^A-Za-z0-9+/=]', '', data)
        
        # Add padding if needed
        padding = len(data) % 4
        if padding:
            data += '=' * (4 - padding)
            
        return data
    except Exception as e:
        logger.error(f"Error cleaning base64 string: {str(e)}")
        return None

def decode_image_data(data: Any) -> Optional[np.ndarray]:
    """Decode image data from bytes or base64 string"""
    try:
        # Handle base64 string
        if isinstance(data, str):
            try:
                cleaned_data = clean_base64_string(data)
                if not cleaned_data:
                    return None
                    
                image_data = base64.b64decode(cleaned_data)
                logger.debug(f"Decoded base64 data length: {len(image_data)}")
            except Exception as e:
                logger.error(f"Base64 decode error: {str(e)}")
                return None
        else:
            image_data = data

        # Validate image data
        if not image_data or len(image_data) < 100:
            logger.error("Invalid image data length")
            return None

        # Decode image
        try:
            nparr = np.frombuffer(image_data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if frame is None or frame.size == 0:
                raise ValueError("Failed to decode image")
                
            return frame
        except Exception as e:
            logger.error(f"Image decode error: {str(e)}")
            return None

    except Exception as e:
        logger.error(f"Image processing error: {str(e)}")
        return None

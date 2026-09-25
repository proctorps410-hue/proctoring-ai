import cv2
import numpy as np
from utils.logger import logger

def validate_frame(frame) -> bool:
    """Validate the frame data"""
    try:
        if frame is None or not isinstance(frame, np.ndarray):
            logger.warning("Invalid frame type")
            return False
            
        if frame.size == 0:
            logger.warning("Empty frame")
            return False
            
        if len(frame.shape) != 3:
            logger.warning(f"Invalid frame dimensions: {frame.shape}")
            return False
            
        height, width = frame.shape[:2]
        if height < 10 or width < 10:
            logger.warning(f"Frame too small: {width}x{height}")
            return False
            
        return True
        
    except Exception as e:
        logger.error(f"Frame validation error: {str(e)}")
        return False

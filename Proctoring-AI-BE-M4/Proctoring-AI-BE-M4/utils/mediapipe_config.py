import os
import multiprocessing
from utils.logger import logger

def configure_mediapipe():
    """Configure MediaPipe with optimized thread settings for macOS"""
    try:
        # Set minimal thread count
        max_threads = min(2, multiprocessing.cpu_count())
        
        # Core MediaPipe configuration
        os.environ["MEDIAPIPE_CPU_ONLY"] = "1"
        os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
        os.environ["OMP_NUM_THREADS"] = str(max_threads)
        os.environ["MEDIAPIPE_NUM_THREADS"] = str(max_threads)
        
        # Thread pool configuration
        os.environ["MEDIAPIPE_USE_MINIMAL_THREADPOOL"] = "true"
        os.environ["MEDIAPIPE_THREAD_PRIORITY"] = "background"
        os.environ["MEDIAPIPE_MAX_CACHED_THREADPOOL_SIZE"] = "1"
        
        # Resource limits
        os.environ["MEDIAPIPE_THREAD_STACK_SIZE"] = "262144"  # 256KB stack
        os.environ["MEDIAPIPE_USE_THREAD_PRIORITIES"] = "false"
        os.environ["MEDIAPIPE_USE_GPU"] = "false"
        
        logger.info(f"MediaPipe configured with {max_threads} threads in minimal mode")
        return True
    except Exception as e:
        logger.error(f"MediaPipe configuration failed: {str(e)}")
        return False

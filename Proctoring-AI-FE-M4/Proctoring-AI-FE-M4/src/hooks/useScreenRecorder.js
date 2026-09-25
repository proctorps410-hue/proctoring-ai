import { useCallback, useEffect, useState } from 'react';

import {
  getScreenRecorderState,
  releaseScreenShare,
  requestScreenShare,
  startScreenRecording,
  stopScreenRecording,
  subscribeToScreenRecorder,
} from '../utils/screenRecorderSession';

export const useScreenRecorder = ({ userId }) => {
  const [state, setState] = useState(getScreenRecorderState());

  useEffect(() => subscribeToScreenRecorder(setState), []);

  const requestRecordingPermission = useCallback(async () => {
    await requestScreenShare();
    return true;
  }, []);

  const startRecording = useCallback(async (options = {}) => {
    await startScreenRecording({
      userId,
      promptIfNeeded: options.promptIfNeeded ?? true,
    });
    return true;
  }, [userId]);

  const stopRecording = useCallback((options = {}) => {
    stopScreenRecording(options);
  }, []);

  return {
    isRecording: state.isRecording,
    hasActiveScreenShare: state.hasActiveScreenShare,
    screenShareDisplaySurface: state.displaySurface,
    error: state.error,
    requestScreenShare: requestRecordingPermission,
    startRecording,
    stopRecording,
    releaseScreenShare,
  };
};

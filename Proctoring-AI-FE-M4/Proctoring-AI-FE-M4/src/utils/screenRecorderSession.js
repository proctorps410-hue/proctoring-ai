let sharedStream = null;
let sharedRecorder = null;
let sharedError = null;
let intentionalStreamShutdown = false;

const subscribers = new Set();

const getActiveStream = () => {
  if (
    sharedStream
    && (
      sharedStream.active
      || sharedStream.getVideoTracks().some((track) => track.readyState === 'live')
    )
  ) {
    return sharedStream;
  }
  return null;
};

const getDisplaySurface = () => {
  const stream = getActiveStream();
  const track = stream?.getVideoTracks?.()[0];
  if (!track || typeof track.getSettings !== 'function') {
    return null;
  }

  return track.getSettings().displaySurface || null;
};

export const getScreenRecorderState = () => ({
  isRecording: Boolean(sharedRecorder && sharedRecorder.state !== 'inactive'),
  hasActiveScreenShare: Boolean(getActiveStream()),
  error: sharedError,
  displaySurface: getDisplaySurface(),
});

const notifySubscribers = () => {
  const snapshot = getScreenRecorderState();
  subscribers.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('Screen recorder subscriber error:', error);
    }
  });
};

const cleanupStream = ({ stopTracks = true, preserveError = false } = {}) => {
  if (sharedStream && stopTracks) {
    intentionalStreamShutdown = true;
    sharedStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (error) {
        console.error('Failed to stop screen-sharing track:', error);
      }
    });
    intentionalStreamShutdown = false;
  }

  sharedStream = null;
  if (!preserveError) {
    sharedError = null;
  }
};

const attachStreamListeners = (stream) => {
  stream.getTracks().forEach((track) => {
    track.onended = () => {
      if (intentionalStreamShutdown) {
        return;
      }

      if (sharedRecorder && sharedRecorder.state !== 'inactive') {
        try {
          sharedRecorder.stop();
        } catch (error) {
          console.error('Failed to stop recorder after screen share ended:', error);
        }
      }

      cleanupStream({ stopTracks: false, preserveError: true });
      sharedRecorder = null;
      sharedError = 'Screen sharing ended. Please enable it again from the exam lobby.';
      notifySubscribers();
    };
  });
};

const uploadChunk = async (blob, userId) => {
  if (!userId) {
    return;
  }

  try {
    const formData = new FormData();
    const timestamp = Date.now();
    const filename = `screen_${userId}_${timestamp}.webm`;

    formData.append('file', blob, filename);

    const token = localStorage.getItem('token');
    const baseUrl = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/+$/, '');

    await fetch(`${baseUrl}/api/v1/exam/session/${userId}/screen-record`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });
  } catch (error) {
    console.error('Failed to upload screen recording chunk:', error);
  }
};

export const subscribeToScreenRecorder = (listener) => {
  subscribers.add(listener);
  listener(getScreenRecorderState());

  return () => {
    subscribers.delete(listener);
  };
};

export const requestScreenShare = async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    const error = new Error('Screen sharing is not supported in this browser.');
    sharedError = error.message;
    notifySubscribers();
    throw error;
  }

  const existingStream = getActiveStream();
  if (existingStream) {
    sharedError = null;
    notifySubscribers();
    return getScreenRecorderState();
  }

  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'monitor',
        logicalSurface: true,
        cursor: 'always',
      },
      audio: false,
    });

    sharedStream = stream;
    sharedError = null;
    attachStreamListeners(stream);
    notifySubscribers();
    return getScreenRecorderState();
  } catch (error) {
    sharedError = error?.name === 'NotAllowedError'
      ? 'Screen sharing was denied. Please allow screen sharing to continue.'
      : error?.message || 'Unable to enable screen sharing.';
    notifySubscribers();
    throw error;
  }
};

export const startScreenRecording = async ({ userId, promptIfNeeded = true } = {}) => {
  let stream = getActiveStream();

  if (!stream) {
    if (!promptIfNeeded) {
      const error = new Error('Screen sharing must be enabled from the exam lobby before starting the exam.');
      sharedError = error.message;
      notifySubscribers();
      throw error;
    }

    await requestScreenShare();
    stream = getActiveStream();
  }

  if (!stream) {
    const error = new Error('Screen sharing is not active.');
    sharedError = error.message;
    notifySubscribers();
    throw error;
  }

  if (sharedRecorder && sharedRecorder.state !== 'inactive') {
    sharedError = null;
    notifySubscribers();
    return true;
  }

  const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp9')
    ? 'video/webm; codecs=vp9'
    : 'video/webm';

  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2500000,
  });

  sharedRecorder = mediaRecorder;

  mediaRecorder.ondataavailable = async (event) => {
    if (event.data && event.data.size > 0) {
      await uploadChunk(event.data, userId);
    }
  };

  mediaRecorder.onstop = () => {
    sharedRecorder = null;
    notifySubscribers();
  };

  mediaRecorder.start(60000);
  sharedError = null;
  notifySubscribers();
  return true;
};

export const stopScreenRecording = ({ releaseStream = true } = {}) => {
  if (sharedRecorder && sharedRecorder.state !== 'inactive') {
    try {
      sharedRecorder.stop();
    } catch (error) {
      console.error('Failed to stop screen recorder:', error);
    }
  } else {
    sharedRecorder = null;
  }

  if (releaseStream) {
    cleanupStream({ stopTracks: true });
  } else {
    sharedError = null;
  }

  notifySubscribers();
};

export const releaseScreenShare = () => {
  stopScreenRecording({ releaseStream: true });
};

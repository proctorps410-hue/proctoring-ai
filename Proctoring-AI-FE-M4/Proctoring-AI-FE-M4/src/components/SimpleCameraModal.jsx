import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, ScanFace, X } from 'lucide-react';
import Modal from './Modal';

const captureFrameFromVideo = async (videoElement) => {
  if (!videoElement || !videoElement.videoWidth || !videoElement.videoHeight) {
    throw new Error('Camera preview is not ready yet.');
  }
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth;
  canvas.height = videoElement.videoHeight;
  const context = canvas.getContext('2d');
  context.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => {
    canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.9);
  });
  if (!blob) throw new Error('Failed to capture face image.');
  return { blob, previewUrl: canvas.toDataURL('image/jpeg', 0.9) };
};

const SimpleCameraModal = ({ isOpen, onClose, onComplete }) => {
  const videoRef = useRef(null);
  const [error, setError] = useState('');
  const [captured, setCaptured] = useState(null);

  useEffect(() => {
    let stream = null;
    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err) {
        setError('Unable to access camera. Please allow permissions.');
      }
    };
    if (isOpen) {
      setCaptured(null);
      setError('');
      startCamera();
    }
    return () => {
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, [isOpen]);

  const handleCapture = async () => {
    try {
      const snapshot = await captureFrameFromVideo(videoRef.current);
      setCaptured(snapshot);
      setTimeout(() => {
        onComplete({ front: snapshot });
      }, 700);
    } catch (err) {
      setError(err.message || 'Capture failed');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} panelClassName="max-w-xl">
      <div className="bg-white p-6 relative">
        <button onClick={onClose} className="absolute right-4 top-4 text-slate-400 hover:text-slate-600">
          <X size={24} />
        </button>
        <div className="mb-4">
          <h3 className="text-xl font-bold flex items-center gap-2 text-slate-900">
            <ScanFace className="text-emerald-500" /> Identity Verification
          </h3>
          <p className="text-sm text-slate-500 mt-1">Please take a clear photo of your face.</p>
        </div>
        
        <div className="relative rounded-2xl overflow-hidden bg-slate-900 h-[340px] flex items-center justify-center">
          {captured ? (
            <img src={captured.previewUrl} alt="Captured" className="w-full h-full object-cover" />
          ) : (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
          )}
          
          {captured && (
            <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center">
              <div className="bg-white rounded-full p-2 text-emerald-500">
                <CheckCircle2 size={40} />
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-rose-500 mt-3 text-sm">{error}</p>}

        {!captured && (
          <button 
            type="button"
            onClick={handleCapture}
            className="mt-6 w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl font-bold transition-all"
          >
            <Camera size={20} /> Capture Photo
          </button>
        )}
      </div>
    </Modal>
  );
};

export default SimpleCameraModal;

import React, { useRef, useState } from 'react';

interface CameraCaptureProps {
  onImageCaptured: (base64Data: string, fileBlob: Blob) => void;
  onClose: () => void;
}

/**
 * Multi-Modal Camera Capture Component
 * Enables field enforcement teams to snapshot operational hazards
 * and push them directly into Bob's Chat Studio stream.
 */
export default function CameraCapture({
  onImageCaptured,
  onClose,
}: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streamActive, setStreamActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize native device camera tracking matrix
  const startCamera = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' }, // Default to field rear camera array
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setStreamActive(true);
      }
    } catch (err) {
      console.error('Hardware camera permission denied:', err);
      setError('Camera access denied. Check device permissions.');
    }
  };

  const captureSnapshot = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      const width = videoRef.current.videoWidth;
      const height = videoRef.current.videoHeight;

      if (context && width && height) {
        canvasRef.current.width = width;
        canvasRef.current.height = height;

        context.drawImage(videoRef.current, 0, 0, width, height);

        const base64Data = canvasRef.current.toDataURL('image/jpeg', 0.85);

        canvasRef.current.toBlob(
          (blob) => {
            if (blob) {
              onImageCaptured(base64Data, blob);
              stopCamera();
            }
          },
          'image/jpeg',
          0.85
        );
      }
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      setStreamActive(false);
      onClose();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#000000',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
        }}
      >
        <span style={{ fontWeight: 'bold', color: '#FFF', fontSize: '16px' }}>
          📸 MULTIMODAL INGRESS HARNESS
        </span>
        <button
          onClick={stopCamera}
          style={{
            backgroundColor: '#222',
            color: '#FFF',
            border: 'none',
            padding: '6px 12px',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Cancel
        </button>
      </div>

      {error && (
        <div
          style={{
            backgroundColor: '#E61919',
            color: '#FFF',
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '12px',
            fontSize: '14px',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          flex: 1,
          backgroundColor: '#111',
          borderRadius: '12px',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '16px',
        }}
      >
        {!streamActive && !error && (
          <button
            onClick={startCamera}
            style={{
              backgroundColor: '#0A84FF',
              color: '#FFF',
              border: 'none',
              padding: '16px 24px',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            Activate Camera Lens
          </button>
        )}

        {error && !streamActive && (
          <div style={{ textAlign: 'center', color: '#888' }}>
            <p>Camera unavailable</p>
            <button
              onClick={startCamera}
              style={{
                backgroundColor: '#0A84FF',
                color: '#FFF',
                border: 'none',
                padding: '12px 20px',
                borderRadius: '8px',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}

        <video
          ref={videoRef}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: streamActive ? 'block' : 'none',
          }}
          playsInline
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>

      {streamActive && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px' }}>
          <button
            onClick={captureSnapshot}
            style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              backgroundColor: '#FFFFFF',
              border: '5px solid #0A84FF',
              cursor: 'pointer',
              outline: 'none',
              transition: 'transform 0.1s',
            }}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform =
                'scale(0.9)';
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform =
                'scale(1)';
            }}
            title="Capture snapshot"
          />
          <button
            onClick={stopCamera}
            style={{
              padding: '12px 24px',
              borderRadius: '8px',
              backgroundColor: '#222',
              color: '#FFF',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '600',
            }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

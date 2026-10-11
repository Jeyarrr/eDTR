import { useEffect, useRef, useState } from 'react';
import { Modal } from './ui';
export function ClockProof({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (photo: string) => Promise<void>;
}) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    alive = useRef(true);
  const [photo, setPhoto] = useState(''),
    [camera, setCamera] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera(false);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  async function startCamera() {
    setError('');
    try {
      stop();
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      if (!alive.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      setPhoto('');
      setCamera(true);
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
    } catch {
      stop();
      setError('Camera unavailable or permission denied. Upload a JPG or PNG instead.');
    }
  }
  return (
    <Modal title="Clock-in photo proof" onClose={busy ? () => {} : onClose}>
      <p>
        Take a photo or upload a JPG/PNG, up to 3 MB. HR can review it with your attendance record.
      </p>
      <div className="proof-options">
        <button className="button secondary" onClick={startCamera} disabled={busy}>
          Use camera
        </button>
        <label className="field">
          Upload JPG / PNG
          <input
            aria-label="Upload clock-in photo"
            type="file"
            accept="image/jpeg,image/png"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setError('');
              setPhoto('');
              stop();
              if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 3 * 1024 * 1024) {
                setError('Choose a JPG or PNG no larger than 3 MB.');
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                if (alive.current) setPhoto(String(reader.result));
              };
              reader.onerror = () => setError('Unable to read that photo.');
              reader.readAsDataURL(file);
            }}
          />
        </label>
      </div>
      <video ref={video} hidden={!camera} autoPlay muted playsInline className="proof-preview" />
      {camera && (
        <button
          className="button primary"
          onClick={() => {
            const source = video.current;
            if (!source?.videoWidth) {
              setError('Wait for the camera preview.');
              return;
            }
            const canvas = document.createElement('canvas');
            canvas.width = Math.min(1200, source.videoWidth);
            canvas.height = Math.round((source.videoHeight * canvas.width) / source.videoWidth);
            canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height);
            setPhoto(canvas.toDataURL('image/jpeg', 0.85));
            stop();
          }}
        >
          Take photo
        </button>
      )}
      {photo && <img className="proof-preview" src={photo} alt="Clock-in proof preview" />}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <div className="form-actions">
        <button className="button secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!photo || busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await onConfirm(photo);
              onClose();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Recording…' : 'Confirm clock in'}
        </button>
      </div>
    </Modal>
  );
}

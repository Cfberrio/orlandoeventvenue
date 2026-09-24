import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Camera, CheckCircle2, FileText, RotateCcw, Upload } from "lucide-react";
import { LICENSE_ACCEPT } from "@/lib/licenseUpload";

interface LicenseCaptureProps {
  file: File | null;
  alreadyUploaded: boolean;
  error: string | null;
  onPick: (file: File) => void;
}

// Phones and tablets: the native camera via <input capture>. Desktops: the
// webcam through getUserMedia, since browsers ignore `capture` there.
const isTouchDevice = () =>
  typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

function WebcamDialog({ open, onClose, onCapture, onUnavailable }: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  onUnavailable: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Held in a ref so a new callback identity doesn't restart the camera.
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setReady(false);
    setMessage(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      onUnavailableRef.current();
      return;
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().then(() => setReady(true)).catch(() => setReady(true));
        }
      })
      .catch(() => {
        if (!cancelled) setMessage("We couldn't access your camera. Check your browser permissions, or upload a file instead.");
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open]);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        onCapture(new File([blob], "license-front.jpg", { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      0.92,
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Take a photo of your license</DialogTitle>
        </DialogHeader>
        {message ? (
          <p className="text-sm text-destructive">{message}</p>
        ) : (
          <>
            <div className="relative overflow-hidden rounded-lg bg-black">
              <video ref={videoRef} playsInline muted className="aspect-video w-full object-contain" />
              {/* Card-shaped guide so the whole license fits in frame */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="aspect-[1.586] w-3/4 rounded-xl border-2 border-dashed border-white/80" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Fit the front of your license inside the frame, with good lighting and no glare.
            </p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          {!message && (
            <Button type="button" onClick={capture} disabled={!ready}>
              <Camera className="mr-2 h-4 w-4" /> Capture
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function LicenseCapture({ file, alreadyUploaded, error, onPick }: LicenseCaptureProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [webcamOpen, setWebcamOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/") || file.type.includes("hei")) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const takePhoto = () => {
    if (isTouchDevice()) cameraInputRef.current?.click();
    else setWebcamOpen(true);
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (picked) onPick(picked);
    e.target.value = "";
  };

  const hasSomething = !!file || alreadyUploaded;

  return (
    <div className="space-y-3">
      {hasSomething ? (
        <div className="flex items-center gap-4 rounded-lg border bg-background p-3">
          {preview ? (
            <img src={preview} alt="License preview" className="h-20 w-32 rounded-md border object-cover" />
          ) : (
            <div className="flex h-20 w-32 items-center justify-center rounded-md border bg-muted">
              {file?.type === "application/pdf" ? <FileText className="h-8 w-8 text-muted-foreground" /> : <CheckCircle2 className="h-8 w-8 text-green-600" />}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 text-sm font-medium text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" /> {file ? "Ready to submit" : "Uploaded"}
            </p>
            {file && <p className="truncate text-xs text-muted-foreground">{file.name}</p>}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={takePhoto}>
            <RotateCcw className="mr-1 h-4 w-4" /> Retake
          </Button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Button type="button" variant={hasSomething ? "outline" : "default"} className="h-14" onClick={takePhoto}>
          <Camera className="mr-2 h-5 w-5" /> Take a Photo
        </Button>
        <Button type="button" variant="outline" className="h-14" onClick={() => fileInputRef.current?.click()}>
          <Upload className="mr-2 h-5 w-5" /> Upload Photo or PDF
        </Button>
      </div>

      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleInput} />
      <input ref={fileInputRef} type="file" accept={LICENSE_ACCEPT} className="sr-only" onChange={handleInput} />

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <WebcamDialog
        open={webcamOpen}
        onClose={() => setWebcamOpen(false)}
        onCapture={onPick}
        onUnavailable={() => {
          setWebcamOpen(false);
          fileInputRef.current?.click();
        }}
      />
    </div>
  );
}

// ==========================================================================
// VERIDO — face detection helper (face-api.js, tiny face detector model)
// Confirms a real face is in frame before letting registration proceed.
// This is presence/liveness-style detection (a face is really there, roughly
// centered, for a sustained moment) — not identity matching against a
// database of faces.
// ==========================================================================

const MODEL_URL = "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";

let modelsLoaded = false;

export async function loadFaceModels() {
  if (modelsLoaded) return;
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
  ]);
  modelsLoaded = true;
}

export async function startCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } },
    audio: false
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

export function stopCamera(stream) {
  if (stream) stream.getTracks().forEach(t => t.stop());
}

// Runs a detection loop; calls onUpdate(isFaceDetected, box) on every tick.
// Returns a stop() function.
export function watchForFace(videoEl, onUpdate) {
  let running = true;
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });

  async function tick() {
    if (!running) return;
    try {
      const det = await faceapi.detectSingleFace(videoEl, opts);
      onUpdate(!!det, det);
    } catch (e) {
      onUpdate(false, null);
    }
    if (running) requestAnimationFrame(tick);
  }
  tick();
  return () => { running = false; };
}

// Captures the current video frame to a JPEG Blob (mirrored back to normal,
// not flipped, since CSS only flips the preview for a mirror-like feel).
export function captureFrame(videoEl) {
  const canvas = document.createElement("canvas");
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), "image/jpeg", 0.9));
}

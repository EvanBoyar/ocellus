// Camera capture: starts the rear camera and hands RGBA frames to a
// callback on a throttled loop.

export async function startCamera(videoEl) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

export function stopCamera(videoEl) {
  const stream = videoEl.srcObject;
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
  }
  videoEl.srcObject = null;
}

// Grabs the current frame, downscaled so the longest edge is maxDim.
export function grabFrame(videoEl, canvas, maxDim = 1280) {
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxDim / Math.max(vw, vh));
  const w = Math.round(vw * scale);
  const h = Math.round(vh * scale);
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(videoEl, 0, 0, w, h);
  return g.getImageData(0, 0, w, h);
}

// Runs `onFrame(imageData)` repeatedly with `intervalMs` between the
// end of one run and the start of the next. Returns a stop function.
export function frameLoop(videoEl, onFrame, intervalMs = 350) {
  const canvas = document.createElement('canvas');
  let stopped = false;
  let timer = null;
  const tick = async () => {
    if (stopped) return;
    const frame = grabFrame(videoEl, canvas);
    if (frame) {
      try {
        await onFrame(frame);
      } catch (err) {
        console.error('frame handler failed', err);
      }
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

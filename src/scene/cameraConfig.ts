/** Presentation only: does not affect simulation or save compatibility. */
export const CAMERA_CONFIG = {
  dragThreshold: 18, // CSS screen pixels from pointer-down; independent of zoom and device pixel ratio.
  // Return interpolation rate per second. Higher is faster; 6 closes 95% of the gap in about 0.5s.
  followReturnSpeed: 6,
  settleDistance: 0.25, // Screen pixels: finish the transition below this distance.
  maxFrameSeconds: 0.05, // Avoid a jump after a background tab or a long frame.
}

// Where the playing field sits in the 3D world and on the screen.
// World units are bubble diameters; the board lies in the plane z = 0, facing the camera.
import { COLS, ROW_H, LAUNCH_Y, FAIL_ROW } from '../config.js';

export const FIELD_W = COLS;
export const FIELD_H = LAUNCH_Y + 1.2; // top edge of the board down to just under the launcher
export const TOP_Y = FIELD_H / 2; // world y of the board's top edge
export const LAUNCH_WORLD_Y = TOP_Y - LAUNCH_Y;
export const FAIL_WORLD_Y = TOP_Y - ((FAIL_ROW - 1) * ROW_H + 1.02); // bubbles must stay above this
export const WATER_Y = -TOP_Y - 0.55;
export const EYE_Y = -4.3; // camera height, which is also where the horizon appears
export const CAM_DIST = 40;

// Fits the field into a w x h pixel viewport, leaving `topPx` for the score bar.
// Returns the rectangle of the z = 0 plane that fills the screen.
export function computeFrame(w, h, topPx) {
  const padX = 0.35;
  const padBottom = 0.3;
  const aspect = w / h;
  const viewH = Math.max((FIELD_W + 2 * padX) / aspect, (FIELD_H + padBottom) / (1 - topPx / h));
  const unit = h / viewH; // pixels per world unit
  const spare = viewH - FIELD_H - padBottom - topPx / unit; // extra height on tall screens
  const top = TOP_Y + topPx / unit + spare * 0.22;
  const viewW = viewH * aspect;
  return { top, bottom: top - viewH, left: -viewW / 2, right: viewW / 2, viewW, viewH, unit };
}

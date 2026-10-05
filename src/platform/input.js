// Mouse, touch, pen and keyboard, reduced to a handful of callbacks.
// A mouse aims by hovering and fires on click; a finger aims while it is down and fires on lift.
export function bindInput(canvas, on) {
  let held = null; // the pointer currently pressed on the canvas

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    held = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture?.(e.pointerId);
    on.aim(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (held && e.pointerId === held.id) {
      if (Math.hypot(e.clientX - held.x, e.clientY - held.y) > 8) held.moved = true;
      on.aim(e.clientX, e.clientY);
    } else if (e.pointerType === 'mouse') on.aim(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!held || e.pointerId !== held.id) return;
    const start = held;
    held = null;
    on.release(e.clientX, e.clientY, start, e.pointerType);
  });
  canvas.addEventListener('pointercancel', () => {
    held = null;
    on.cancel();
  });
  canvas.addEventListener('pointerleave', (e) => {
    if (!held && e.pointerType === 'mouse') on.cancel();
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    on.swap();
  });
  addEventListener('keydown', on.key);
}

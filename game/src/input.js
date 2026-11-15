// input.js — keyboard + mouse input with pointer lock for MERIDIAN DEPOT.
// Accumulates mouse deltas; the game consumes them once per tick so no
// movement is ever double-applied.
export function createInput(canvas) {
  const input = {
    keys: new Set(),
    pressed: new Set(), // codes pressed since last consumePressed() (no repeats)
    mouseDX: 0,
    mouseDY: 0,
    mouseDown: false,
    mouseDownRight: false,
    wheelDelta: 0,
    locked: false,
  };

  input.consumeMouse = function () {
    const out = { dx: input.mouseDX, dy: input.mouseDY };
    input.mouseDX = 0;
    input.mouseDY = 0;
    return out;
  };

  /** True once per physical key press (auto-repeat ignored). */
  input.consumePressed = function (code) {
    if (input.pressed.has(code)) {
      input.pressed.delete(code);
      return true;
    }
    return false;
  };

  input.consumeWheel = function () {
    const d = input.wheelDelta;
    input.wheelDelta = 0;
    return d;
  };

  input.requestLock = function () {
    if (document.pointerLockElement === canvas) return;
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Pointer lock unavailable (e.g. headless screenshot run) — ignore.
    }
  };

  input.exitLock = function () {
    if (document.pointerLockElement) document.exitPointerLock();
  };

  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
  });

  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX || 0;
    input.mouseDY += e.movementY || 0;
  });

  window.addEventListener('keydown', (e) => {
    // Do not swallow browser shortcuts when the user is typing in a field.
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (!e.repeat) input.pressed.add(e.code);
    input.keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    input.keys.delete(e.code);
    input.pressed.delete(e.code);
  });
  window.addEventListener('blur', () => {
    input.keys.clear();
    input.mouseDown = false;
    input.mouseDownRight = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) input.mouseDown = true;
    if (e.button === 2) input.mouseDownRight = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.mouseDown = false;
    if (e.button === 2) input.mouseDownRight = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    input.wheelDelta += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  return input;
}

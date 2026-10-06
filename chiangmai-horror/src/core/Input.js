// Keyboard + mouse state. Uses pointer lock when the browser grants it and
// falls back to free-mouse look (with edge turning) when it does not, so the
// prototype stays playable inside sandboxed frames.

export class Input {
  constructor(element) {
    this.el = element;
    this.keys = new Set();
    this.pressedKeys = new Set();
    this.buttons = [false, false, false];
    this.pressedButtons = [false, false, false];
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    /** 'lock' = pointer lock, 'free' = fallback look. */
    this.mode = 'lock';
    this.enabled = false;
    this.cursorX = 0.5;
    this.cursorY = 0.5;
    this.onLockLost = null;
    this.onFallback = null;
    this._lockRequestedAt = 0;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'AltLeft') e.preventDefault();
      if (!e.repeat) this.pressedKeys.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.clear());

    element.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (e.button < 3) {
        this.buttons[e.button] = true;
        this.pressedButtons[e.button] = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button < 3) this.buttons[e.button] = false;
    });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.mode === 'lock' && !this.locked) return;
      // Some browsers report a huge bogus delta right after the pointer locks.
      const mx = e.movementX || 0, my = e.movementY || 0;
      if (Math.abs(mx) < 260 && Math.abs(my) < 260) {
        this.dx += mx;
        this.dy += my;
      }
      const r = this.el.getBoundingClientRect();
      this.cursorX = (e.clientX - r.left) / Math.max(1, r.width);
      this.cursorY = (e.clientY - r.top) / Math.max(1, r.height);
    });

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (was && !this.locked && this.mode === 'lock') {
        this.clear();
        if (this.onLockLost) this.onLockLost();
      }
    });
    document.addEventListener('pointerlockerror', () => this._useFallback());
  }

  _useFallback() {
    if (this.mode === 'free') return;
    this.mode = 'free';
    if (this.onFallback) this.onFallback();
  }

  /** Must be called from a user gesture. */
  capture() {
    this.enabled = true;
    if (this.mode !== 'lock') return;
    if (!this.el.requestPointerLock) return this._useFallback();
    try {
      const p = this.el.requestPointerLock();
      if (p && p.catch) p.catch(() => this._useFallback());
    } catch (err) {
      this._useFallback();
    }
    // Some embedded views neither grant the lock nor report an error.
    this._lockRequestedAt = performance.now();
    setTimeout(() => {
      if (this.enabled && !this.locked && this.mode === 'lock') this._useFallback();
    }, 900);
  }

  release() {
    this.enabled = false;
    this.clear();
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }

  clear() {
    this.keys.clear();
    this.pressedKeys.clear();
    this.buttons.fill(false);
    this.pressedButtons.fill(false);
    this.dx = 0;
    this.dy = 0;
  }

  down(code) {
    return this.keys.has(code);
  }

  pressed(code) {
    return this.pressedKeys.has(code);
  }

  mouse(button) {
    return this.buttons[button];
  }

  mousePressed(button) {
    return this.pressedButtons[button];
  }

  /**
   * Look delta in pixels for this frame. In free mode the cursor near a screen
   * edge keeps turning the camera, since the mouse cannot travel forever.
   */
  consumeLook(dt) {
    let dx = this.dx, dy = this.dy;
    this.dx = 0;
    this.dy = 0;
    if (this.mode === 'free' && this.enabled) {
      const edge = 0.12;
      const push = (v) => (v < edge ? -(edge - v) / edge : v > 1 - edge ? (v - (1 - edge)) / edge : 0);
      dx += push(this.cursorX) * 900 * dt;
      dy += push(this.cursorY) * 420 * dt;
    }
    return { dx, dy };
  }

  endFrame() {
    this.pressedKeys.clear();
    this.pressedButtons.fill(false);
  }
}

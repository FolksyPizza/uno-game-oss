// Unified input: keyboard + mouse + touch, mapped into logical canvas coords.
// Per-frame state (pressed keys, clicks) is cleared by endFrame().

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keysDown = new Set();
    this.keysPressed = new Set();   // pressed this frame
    this.pointer = { x: 0, y: 0, down: false };
    this.clicks = [];               // {x,y} that occurred this frame

    window.addEventListener('keydown', (e) => {
      if (!this.keysDown.has(e.code)) this.keysPressed.add(e.code);
      this.keysDown.add(e.code);
      // stop the page from scrolling on arrows/space
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.code));

    const setPointer = (clientX, clientY) => {
      const r = canvas.getBoundingClientRect();
      this.pointer.x = (clientX - r.left) / r.width * canvas.width;
      this.pointer.y = (clientY - r.top) / r.height * canvas.height;
    };

    canvas.addEventListener('mousemove', (e) => setPointer(e.clientX, e.clientY));
    canvas.addEventListener('mousedown', (e) => {
      setPointer(e.clientX, e.clientY);
      this.pointer.down = true;
      this.clicks.push({ x: this.pointer.x, y: this.pointer.y });
    });
    window.addEventListener('mouseup', () => { this.pointer.down = false; });

    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      setPointer(t.clientX, t.clientY);
      this.pointer.down = true;
      this.clicks.push({ x: this.pointer.x, y: this.pointer.y });
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      setPointer(t.clientX, t.clientY);
    }, { passive: false });
    window.addEventListener('touchend', () => { this.pointer.down = false; });
  }

  isDown(code) { return this.keysDown.has(code); }
  justPressed(code) { return this.keysPressed.has(code); }
  anyKeyPressed() { return this.keysPressed.size > 0; }

  // Returns a click {x,y} if one happened this frame (consumes nothing).
  get clicked() { return this.clicks.length > 0; }

  endFrame() {
    this.keysPressed.clear();
    this.clicks.length = 0;
  }
}

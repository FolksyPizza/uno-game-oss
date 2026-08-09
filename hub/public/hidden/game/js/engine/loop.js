// Fixed-timestep game loop with an accumulator, so physics/timers are
// frame-rate independent. update() may run 0..N times per rendered frame.

export function startLoop(update, render) {
  const STEP = 1 / 60;
  let last = performance.now() / 1000;
  let acc = 0;

  function frame(nowMs) {
    const now = nowMs / 1000;
    let dt = now - last;
    last = now;
    if (dt > 0.25) dt = 0.25; // avoid spiral of death after a tab pause
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      update(STEP);
      acc -= STEP;
      steps++;
    }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

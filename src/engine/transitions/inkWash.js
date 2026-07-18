// A circular reveal grows from a random point, evoking a spreading ink
// blot/watercolor wash — a CSS clip-path approximation, no canvas needed.
export function inkWash({ activeEl, waitingEl, durationMs }) {
  return new Promise(resolve => {
    const x = 20 + Math.random() * 60;
    const y = 20 + Math.random() * 60;

    waitingEl.style.transition = 'none';
    waitingEl.style.opacity = '1';
    waitingEl.style.clipPath = `circle(0% at ${x}% ${y}%)`;
    activeEl.style.transition = 'none';

    requestAnimationFrame(() => {
      waitingEl.style.transition = `clip-path ${durationMs}ms ease-in-out`;
      waitingEl.style.clipPath = `circle(150% at ${x}% ${y}%)`;
    });

    setTimeout(() => {
      activeEl.style.opacity = '0';
      waitingEl.style.clipPath = '';
      resolve();
    }, durationMs);
  });
}

import { play } from './animate.js';

// A circular reveal grows from a random point, evoking a spreading ink
// blot/watercolor wash — a clip-path animation, no canvas needed.
export function inkWash({ activeEl, waitingEl, durationMs }) {
  const x = 20 + Math.random() * 60;
  const y = 20 + Math.random() * 60;

  waitingEl.style.opacity = '1';

  return play(waitingEl, [
    { clipPath: `circle(0% at ${x}% ${y}%)` },
    { clipPath: `circle(150% at ${x}% ${y}%)` },
  ], { durationMs }).then(() => {
    activeEl.style.opacity = '0';
    // Clear the clip so the element is unrestricted next time it's the
    // incoming slide — a committed clip-path would crop the following image.
    waitingEl.style.clipPath = '';
  });
}

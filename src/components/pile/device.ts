const PHONE_LIVE_LIMIT = 150;

// A phone has a touch screen and a short side under 820 CSS pixels.
export function onPhone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches &&
    Math.min(window.screen.width, window.screen.height) < 820
  );
}

// The most rigid bodies the pile keeps alive at one time.
export function liveLimit() {
  return onPhone() ? PHONE_LIVE_LIMIT : Number.POSITIVE_INFINITY;
}

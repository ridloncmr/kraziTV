/** The shading tones every original desktop drawing shares. */
type IconTone = "blue" | "gold" | "silver";

/** References one tone of the `IconGradients` defined under the same `id` in this SVG. */
export function iconGradient(id: string, tone: IconTone): string {
  return `url(#${id}-${tone})`;
}

/**
 * Defines the blue, gold, and silver shading of kraziTV's original vector
 * artwork once, so every icon and illustration draws from one palette. Each
 * SVG passes its own `useId()` so repeated drawings never share element ids.
 */
export function IconGradients({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`${id}-blue`} x2=".3" y2="1">
        <stop stopColor="#9dd9ff" />
        <stop offset=".4" stopColor="#3988e2" />
        <stop offset="1" stopColor="#114791" />
      </linearGradient>
      <linearGradient id={`${id}-gold`} x2=".2" y2="1">
        <stop stopColor="#fff4a2" />
        <stop offset=".45" stopColor="#f7c94b" />
        <stop offset="1" stopColor="#c7811a" />
      </linearGradient>
      <linearGradient id={`${id}-silver`} x2=".2" y2="1">
        <stop stopColor="#fafaff" />
        <stop offset=".5" stopColor="#c7d7e5" />
        <stop offset="1" stopColor="#6886a7" />
      </linearGradient>
    </defs>
  );
}

// deno-lint-ignore-file no-explicit-any
// Stub for src/ui.ts: the sims run against a fake DOM, so anything that would
// need a real element, canvas or gsap is replaced here. Not type-checked (the
// sims are drivers, run with `deno run`), hence the loose signatures.
export { hasThai, segmentThai } from './segment.ts';
export const $ = (sel: string): any => (globalThis as any).__dom(sel);
export function show(): void {}
export function modal(html: string): any {
  (globalThis as any).__modals.push(html);
  return { querySelector: () => ({ set onclick(f: any) { (globalThis as any).__modalGo = f; } }) };
}
export function closeModal(): void {}
export const inserted = (e: any): string | null =>
  typeof e?.data === 'string' ? e.data : null;
// the real one throws when a selector misses; here every button just records
// its handler, which is all a sim ever needs from a modal
export function on(_root: any, _sel: string, fn: () => void): void {
  (globalThis as any).__modalGo = fn;
}

export { segmentThai } from './segment.js';
export const $ = (sel) => globalThis.__dom(sel);
export function show(){}
export function modal(html){ globalThis.__modals.push(html); return { querySelector: () => ({ set onclick(f){ globalThis.__modalGo = f; } }) }; }
export function closeModal(){}

// deno-lint-ignore-file no-explicit-any
// Stub for src/records.ts: runs are kept in memory so a sim can seed a history
// and read back what the session saved.
export let saved: any[] = [];
export let history: any[] = [];
export async function saveRun(r: any): Promise<void> { saved.push(r); }
export async function loadRuns(): Promise<any[]> { return history; }
export function setHistory(h: any[]): void { history = h; }

export let saved = [];
export let history = [];
export async function saveRun(r){ saved.push(r); }
export async function loadRuns(){ return history; }
export function setHistory(h){ history = h; }

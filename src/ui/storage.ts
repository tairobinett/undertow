// localStorage wrappers. Storage can be unavailable (private mode, blocked, previews), so
// every access is guarded and the game works without it.

const SAVE_KEY = 'undertow.save.v1';
const HIST_KEY = 'undertow.history.v1';
const PREF_KEY = 'undertow.prefs.v1';
const CODEX_KEY = 'undertow.codex.v1';

export function saveGame(json: string): void {
  try {
    localStorage.setItem(SAVE_KEY, json);
  } catch {
    /* ignore */
  }
}

export function loadGame(): string | null {
  try {
    return localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export interface RunRecord {
  date: string;
  seed: number;
  won: boolean;
  depth: number;
  cause: string;
  weapon: string;
  turns: number;
  kills: number;
}

export function loadHistory(): RunRecord[] {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    return raw ? (JSON.parse(raw) as RunRecord[]) : [];
  } catch {
    return [];
  }
}

export function pushHistory(r: RunRecord): void {
  try {
    const h = loadHistory();
    h.unshift(r);
    localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 50)));
  } catch {
    /* ignore */
  }
}

/** What every run so far has shown you. It carries over: knowledge is the meta-progression. */
export interface Codex {
  /** Creatures met, with how many times each has killed you. */
  monsters: Record<string, { killedYou: number }>;
  relics: string[];
  items: string[];
}

export function loadCodex(): Codex {
  const empty: Codex = { monsters: {}, relics: [], items: [] };
  try {
    const raw = localStorage.getItem(CODEX_KEY);
    if (!raw) return empty;
    const c = JSON.parse(raw) as Partial<Codex>;
    return { monsters: c.monsters ?? {}, relics: c.relics ?? [], items: c.items ?? [] };
  } catch {
    return empty;
  }
}

export function saveCodex(c: Codex): void {
  try {
    localStorage.setItem(CODEX_KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export interface Prefs {
  seenHelp?: boolean;
  anim?: 'full' | 'fast';
  tips?: string[];
  sound?: boolean;
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return raw ? (JSON.parse(raw) as Prefs) : {};
  } catch {
    return {};
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

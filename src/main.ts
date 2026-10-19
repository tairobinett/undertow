// Browser entry point.
import { App } from './ui/app.ts';

function boot(): void {
  const app = new App();
  (window as unknown as { undertow: App }).undertow = app;
  const pad = document.getElementById('pad');
  pad?.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || !app.state || app.modalOpen) return;
    const k = b.dataset.k;
    const fire = (key: string, code: string, shiftKey = false): void => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, code, shiftKey }));
    };
    if (k === 'wait') fire('.', 'Period');
    else if (k === 'explore') fire('z', 'KeyZ');
    else if (k === 'pick') fire('g', 'KeyG');
    else if (k === 'up') fire('<', 'Comma', true);
    else if (k === 'look') fire('x', 'KeyX');
    else if (k === 'menu') fire('Escape', 'Escape');
  });
  // When published, a redeploy hot-swaps the page: keep the run going across it.
  const hot = (window as unknown as { claude?: { hot?: HotApi } }).claude?.hot;
  hot?.snapshot?.(() => ({ save: app.state && app.state.status === 'playing' ? serializeState(app) : null }));
  const start = (data: { save?: string | null }): void => {
    const params = new URLSearchParams(location.search);
    const seed = params.get('seed');
    if (data?.save && app.resume(data.save)) return;
    if (seed !== null) app.newRun(Number(seed) >>> 0);
    else app.showTitle();
  };
  if (hot?.ready) hot.ready(start);
  else start((hot?.data as { save?: string | null }) ?? {});
}

interface HotApi {
  snapshot?: (fn: () => unknown) => void;
  ready?: (fn: (data: { save?: string | null }) => void) => void;
  data?: unknown;
}

function serializeState(app: App): string | null {
  try {
    return app.serialize();
  } catch {
    return null;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

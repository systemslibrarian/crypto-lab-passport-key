/**
 * Passport Key — panel wiring.
 *
 * Six exhibits as tabs. Each panel renders lazily on first activation and is
 * hidden AND EMPTY until then, which is the property the accessibility gate
 * asserts: an empty region is exactly what a scan reports as perfectly
 * accessible, so "empty" has to be the tell that a renderer threw rather than
 * a state nobody checks.
 *
 * Exhibit 1 renders at mount so first paint carries real content — the ICAO
 * specimen, its check-digit working and the MRZ_information string — rather
 * than a placeholder.
 */
import './style.css';
import { renderPrintedData } from './ui/printedData';
import { renderKeyDerivation } from './ui/keyDerivation';
import { renderHandshake } from './ui/handshake';
import { renderCounting } from './ui/counting';
import { renderOfflineSearch } from './ui/offlineSearch';
import { renderReplacement } from './ui/replacement';

type PanelName = 'printed' | 'keys' | 'handshake' | 'counting' | 'search' | 'pace';

const renderers: Record<PanelName, (panel: HTMLElement) => void> = {
  printed: renderPrintedData,
  keys: renderKeyDerivation,
  handshake: renderHandshake,
  counting: renderCounting,
  search: renderOfflineSearch,
  pace: renderReplacement,
};

const rendered = new Set<PanelName>();

function panelOf(name: PanelName): HTMLElement {
  const node = document.getElementById(`panel-${name}`);
  if (!node) throw new Error(`no panel for ${name}`);
  return node;
}

function tabOf(name: PanelName): HTMLElement {
  const node = document.getElementById(`tab-${name}`);
  if (!node) throw new Error(`no tab for ${name}`);
  return node;
}

function ensureRendered(name: PanelName): void {
  if (rendered.has(name)) return;
  rendered.add(name);
  renderers[name](panelOf(name));
}

function activate(name: PanelName): void {
  for (const other of Object.keys(renderers) as PanelName[]) {
    const tab = tabOf(other);
    const panel = panelOf(other);
    const selected = other === name;
    tab.setAttribute('aria-selected', String(selected));
    // Only the selected tab is in the tab order; the rest are reached with
    // the arrow keys, which is the tablist pattern a screen reader expects.
    tab.setAttribute('tabindex', selected ? '0' : '-1');
    panel.hidden = !selected;
  }
  ensureRendered(name);
}

function names(): PanelName[] {
  return Object.keys(renderers) as PanelName[];
}

function wireTabs(): void {
  const all = names();
  for (const name of all) {
    const tab = tabOf(name);
    tab.addEventListener('click', () => activate(name));
    tab.addEventListener('keydown', (event: KeyboardEvent) => {
      const index = all.indexOf(name);
      let next: PanelName | null = null;
      if (event.key === 'ArrowRight') next = all[(index + 1) % all.length];
      else if (event.key === 'ArrowLeft') next = all[(index - 1 + all.length) % all.length];
      else if (event.key === 'Home') next = all[0];
      else if (event.key === 'End') next = all[all.length - 1];
      if (next === null) return;
      event.preventDefault();
      activate(next);
      tabOf(next).focus();
    });
  }
}

wireTabs();
// The arrival state: exhibit 1 rendered, the other five hidden and empty.
ensureRendered('printed');

/**
 * Element helpers.
 *
 * Every panel builds its DOM here rather than assigning `innerHTML`, for one
 * reason that matters to this lab in particular: a learner can type into these
 * panels, and a document number or a date that round-tripped through an HTML
 * string would be an injection waiting for a `<`. The MRZ filler character IS
 * `<`, so that is not a hypothetical — it appears in the specimen on first
 * paint.
 */

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

/** Create an element with attributes and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') node.className = String(value);
    else if (name === 'text') node.textContent = String(value);
    else node.setAttribute(name, String(value));
  }
  append(node, ...children);
  return node;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** A labelled value row, as the `.field` grid. */
export function field(label: string, value: Child, note?: string): HTMLElement {
  return el(
    'div',
    { class: 'field' },
    el('span', { class: 'field-label', text: label }),
    el('span', { class: 'field-value' }, value),
    note ? el('span', { class: 'field-note', text: note }) : undefined
  );
}

/** A hex value, in tabular figures with byte grouping. */
export function hex(value: string, perGroup = 4): HTMLElement {
  const groups: string[] = [];
  for (let i = 0; i < value.length; i += perGroup * 2) {
    groups.push(value.slice(i, i + perGroup * 2));
  }
  return el('code', { class: 'hex', text: groups.join(' ') });
}

export type VerdictTone = 'pass' | 'fail' | 'alarm' | 'info';

/**
 * A verdict: an icon, a word and a colour — never a colour alone.
 *
 * The icon is `aria-hidden` because the word beside it already says the same
 * thing, and a screen reader announcing "check mark VALID" reads the state
 * twice.
 */
export function verdict(
  tone: VerdictTone,
  text: string,
  detail?: Child,
  extraClass?: string
): HTMLElement {
  const icons: Record<VerdictTone, string> = {
    pass: '✓',
    fail: '✗',
    alarm: '!',
    info: 'i',
  };
  return el(
    'div',
    {
      class: `verdict verdict-${tone}${extraClass ? ` ${extraClass}` : ''}`,
      role: 'status',
      'aria-live': 'polite',
    },
    el('span', { class: 'verdict-icon', 'aria-hidden': 'true', text: icons[tone] }),
    el(
      'span',
      {},
      el('span', { class: 'verdict-text', text }),
      detail ? el('span', { class: 'verdict-detail' }, detail) : undefined
    )
  );
}

/**
 * The notice that replaces a verdict when an input changes.
 *
 * It says what changed, so the disappearance reads as deliberate rather than
 * as the page losing its place. §4.1b requires both halves: the stale verdict
 * is gone AND the page says it was retired.
 */
export function retired(what: string): HTMLElement {
  return el(
    'div',
    { class: 'evidence-retired', role: 'status', 'aria-live': 'polite' },
    el('span', { 'aria-hidden': 'true', text: '↻' }),
    el('span', { text: `${what} — the previous result no longer describes what is on screen. Run it again.` })
  );
}

/** A `<details>` disclosure, shut by default. */
export function disclosure(summaryText: string, ...children: Child[]): HTMLDetailsElement {
  const node = el('details', {}, el('summary', { text: summaryText }));
  append(node, el('div', { class: 'details-body' }, ...children));
  return node as HTMLDetailsElement;
}

/** A quotation from a primary source, with its citation. */
export function quote(text: string, source: string): HTMLElement {
  return el(
    'div',
    { class: 'callout callout-source' },
    el('blockquote', {}, el('p', { text })),
    el('cite', { text: source })
  );
}

export function caveat(title: string, ...children: Child[]): HTMLElement {
  return el(
    'div',
    { class: 'callout callout-caveat' },
    el('span', { class: 'callout-title', text: title }),
    ...children
  );
}

/** A table from a header row and body rows. */
export function table(
  caption: string,
  headers: readonly { readonly text: string; readonly numeric?: boolean }[],
  rows: readonly (readonly Child[])[]
): HTMLElement {
  const head = el(
    'tr',
    {},
    ...headers.map((h) => el('th', { scope: 'col', class: h.numeric ? 'num' : undefined }, h.text))
  );
  const body = rows.map((cells) =>
    el(
      'tr',
      {},
      ...cells.map((cell, i) =>
        el('td', { class: headers[i]?.numeric ? 'num' : undefined }, cell)
      )
    )
  );
  return el(
    'div',
    { class: 'table-wrap', role: 'region', tabindex: '0', 'aria-label': caption },
    el(
      'table',
      {},
      el('caption', { text: caption }),
      el('thead', {}, head),
      el('tbody', {}, ...body)
    )
  );
}

/** A labelled text input with an error slot. */
export interface TextControl {
  readonly wrapper: HTMLElement;
  readonly input: HTMLInputElement;
  readonly error: HTMLElement;
  setError(message: string | null): void;
}

export function textControl(options: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly maxlength?: number;
  readonly size?: number;
}): TextControl {
  const hintId = `${options.id}-hint`;
  const errorId = `${options.id}-error`;
  const input = el('input', {
    type: 'text',
    id: options.id,
    value: options.value,
    maxlength: options.maxlength,
    size: options.size,
    spellcheck: 'false',
    autocapitalize: 'characters',
    'aria-invalid': 'false',
    // The hint is described by default; the error is ADDED to the description
    // only while it is showing. A permanently-referenced empty error element
    // would have a screen reader announce nothing after the hint, which reads
    // as the field having a blank description rather than no error.
    'aria-describedby': options.hint ? hintId : undefined,
  }) as HTMLInputElement;
  const error = el('p', {
    class: 'field-error',
    id: errorId,
    role: 'status',
    'aria-live': 'polite',
  });
  error.hidden = true;
  const wrapper = el(
    'div',
    { class: 'control' },
    el('label', { for: options.id, text: options.label }),
    input,
    options.hint ? el('span', { class: 'control-hint', id: hintId, text: options.hint }) : undefined,
    error
  );
  return {
    wrapper,
    input,
    error,
    setError(message) {
      const describedBy = options.hint ? [hintId] : [];
      if (message === null) {
        error.hidden = true;
        error.textContent = '';
        input.setAttribute('aria-invalid', 'false');
        if (describedBy.length) input.setAttribute('aria-describedby', describedBy.join(' '));
        else input.removeAttribute('aria-describedby');
        return;
      }
      error.hidden = false;
      error.textContent = message;
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', [...describedBy, errorId].join(' '));
    },
  };
}

/** A labelled `<select>` built from options. */
export function selectControl(options: {
  readonly id: string;
  readonly label: string;
  readonly choices: readonly { readonly value: string; readonly text: string }[];
  readonly value?: string;
  readonly hint?: string;
}): { readonly wrapper: HTMLElement; readonly select: HTMLSelectElement } {
  const select = el(
    'select',
    { id: options.id },
    ...options.choices.map((choice) =>
      el('option', { value: choice.value, selected: choice.value === options.value }, choice.text)
    )
  ) as HTMLSelectElement;
  if (options.value !== undefined) select.value = options.value;
  const wrapper = el(
    'div',
    { class: 'control' },
    el('label', { for: options.id, text: options.label }),
    select,
    options.hint ? el('span', { class: 'control-hint', text: options.hint }) : undefined
  );
  return { wrapper, select };
}

/** A number formatted with thousands separators. */
export function formatCount(value: bigint | number): string {
  return value.toLocaleString('en');
}

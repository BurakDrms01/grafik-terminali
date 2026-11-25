// Küçük DOM yardımcıları: öğe oluşturma, modal, açılır menü, bildirim.

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = String(value);
      else if (key === 'text') el.textContent = String(value);
      else if (key === 'html') el.innerHTML = String(value);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key in el && typeof value !== 'string') {
        (el as unknown as Record<string, unknown>)[key] = value;
      } else {
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

// ---------- Modal ----------

export interface ModalHandle {
  close(): void;
  body: HTMLElement;
}

const openModals: ModalHandle[] = [];

export function isModalOpen(): boolean {
  return openModals.length > 0;
}

export function modal(
  title: string,
  content: HTMLElement,
  opts: { small?: boolean; wide?: boolean; onClose?: () => void } = {},
): ModalHandle {
  const body = h('div', { class: 'modal-body' }, content);
  const closeBtn = h('button', { class: 'modal-close', title: 'Kapat (Esc)', 'aria-label': 'Kapat', text: '×' });
  const box = h(
    'div',
    { class: `modal${opts.small ? ' small' : ''}${opts.wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', { text: title }), closeBtn),
    body,
  );
  const backdrop = h('div', { class: 'modal-backdrop' }, box);
  const previousFocus = document.activeElement as HTMLElement | null;

  let closed = false;
  const handle: ModalHandle = {
    body,
    close() {
      if (closed) return;
      closed = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      const i = openModals.indexOf(handle);
      if (i >= 0) openModals.splice(i, 1);
      opts.onClose?.();
      previousFocus?.focus?.();
    },
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && openModals[openModals.length - 1] === handle) {
      e.stopPropagation();
      handle.close();
    }
  };
  closeBtn.addEventListener('click', () => handle.close());
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) handle.close();
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  openModals.push(handle);
  return handle;
}

export function confirmDialog(title: string, text: string, okText = 'Tamam', danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, text: okText });
    const cancel = h('button', { class: 'btn', text: 'Vazgeç' });
    const m = modal(title, h('div', null, h('p', { text }), h('div', { class: 'modal-actions' }, cancel, ok)), {
      small: true,
      onClose: () => resolve(result),
    });
    ok.addEventListener('click', () => {
      result = true;
      m.close();
    });
    cancel.addEventListener('click', () => m.close());
    ok.focus();
  });
}

export function promptDialog(title: string, label: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const input = h('input', { type: 'text', value: initial });
    const ok = h('button', { class: 'btn primary', text: 'Tamam', type: 'submit' });
    const cancel = h('button', { class: 'btn', text: 'Vazgeç', type: 'button' });
    const form = h(
      'form',
      null,
      h('div', { class: 'field' }, h('label', { text: label }), input),
      h('div', { class: 'modal-actions' }, cancel, ok),
    );
    const m = modal(title, form, { small: true, onClose: () => resolve(result) });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      result = input.value.trim() || null;
      m.close();
    });
    cancel.addEventListener('click', () => m.close());
    input.focus();
    input.select();
  });
}

// ---------- Açılır menü ----------

export function popover(
  anchor: HTMLElement,
  content: HTMLElement,
  className = '',
  placement: 'below' | 'right' | 'above' = 'below',
): () => void {
  const pop = h('div', { class: `popover ${className}` }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const ph = pop.offsetHeight;
  if (placement === 'right') {
    pop.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - ph - 8))}px`;
    pop.style.left = `${Math.min(r.right + 6, window.innerWidth - w - 8)}px`;
  } else if (placement === 'above') {
    pop.style.top = `${Math.max(8, r.top - ph - 4)}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  } else {
    pop.style.top = `${r.bottom + 4}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  }

  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onDown = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  return close;
}

/** Sağ tık menüsü gibi, verilen ekran noktasında açılan menü. */
export function menuAt(x: number, y: number, content: HTMLElement, className = 'tool-menu'): () => void {
  const pop = h('div', { class: `popover ${className}`, role: 'menu' }, content);
  document.body.append(pop);
  const w = pop.offsetWidth;
  const ph = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(x, window.innerWidth - w - 8))}px`;
  pop.style.top = `${Math.max(8, Math.min(y, window.innerHeight - ph - 8))}px`;
  const close = () => {
    pop.remove();
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
  };
  const onDown = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  // Menüyü açan tıklama hemen kapatmasın.
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
  }, 0);
  return close;
}

export interface MenuItem {
  label: string;
  icon?: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

/** Menü satırları; null ayırıcı çizgidir. */
export function menuList(items: (MenuItem | null)[], close: () => void, title?: string): HTMLElement {
  const box = h('div', null, title ? h('div', { class: 'menu-title', text: title }) : null);
  for (const it of items) {
    if (!it) {
      box.append(h('div', { class: 'menu-sep' }));
      continue;
    }
    const row = h(
      'button',
      { class: `menu-row${it.danger ? ' danger' : ''}`, disabled: !!it.disabled, role: 'menuitem' },
      h('span', { class: 'menu-icon', html: it.icon ?? '' }),
      h('span', { class: 'menu-label', text: it.label }),
      it.hint ? h('span', { class: 'menu-hint', text: it.hint }) : null,
    );
    row.addEventListener('click', () => {
      close();
      it.onClick();
    });
    box.append(row);
  }
  return box;
}

// ---------- Bildirim ----------

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export function toast(title: string, text = '', kind: 'info' | 'error' | 'alert' = 'info', ms = 5000, action?: ToastAction): void {
  const root = document.getElementById('toasts');
  if (!root) return;
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, h('b', { text: title }), text);
  if (action) {
    const btn = h('button', { class: 'toast-action', text: action.label, type: 'button' });
    btn.addEventListener('click', () => {
      el.remove();
      action.onClick();
    });
    el.append(btn);
  }
  root.append(el);
  while (root.children.length > 5) root.firstElementChild?.remove();
  setTimeout(() => el.remove(), ms);
}

/** Kullanıcı bir yazı alanındayken klavye kısayollarını devre dışı bırakmak için. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

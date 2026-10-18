// A non-modal reading aid: hover/focus previews, click/tap pins the note.
export function attachNotePopover(root, popup) {
  if (!popup) return () => {};
  const doc = popup.ownerDocument, win = doc.defaultView;
  const title = popup.querySelector('[data-note-title]');
  const content = popup.querySelector('[data-note-content]');
  const fullLink = popup.querySelector('[data-note-full]');
  const closeButton = popup.querySelector('[data-note-close]');
  const abort = new win.AbortController();
  const on = (node, type, fn, options = {}) => node.addEventListener(type, fn, {...options, signal:abort.signal});
  let active = null, pinned = false, openTimer, closeTimer, suppressFocus = false;
  const refFrom = node => node?.closest?.('a.note-ref[data-note]');
  function position() {
    if (!active || popup.hidden) return;
    const rect = active.getBoundingClientRect();
    const vw = win.innerWidth, vh = win.innerHeight;
    if (rect.bottom < 0 || rect.top > vh) { close(); return; }
    if (vw <= 600) {
      popup.style.left = '12px'; popup.style.top = 'auto'; popup.style.bottom = '12px';
      popup.style.maxHeight = `${Math.max(140, vh * .55)}px`;
      return;
    }
    popup.style.bottom = 'auto'; popup.style.maxHeight = `${Math.max(140, Math.min(420, vh - 24))}px`;
    const box = popup.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.left - 20, vw - box.width - 12));
    const below = rect.bottom + 10;
    const top = below + box.height <= vh - 12 ? below : Math.max(12, rect.top - box.height - 10);
    popup.style.left = `${left}px`; popup.style.top = `${top}px`;
  }
  function close(restoreFocus = false) {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    const ref = active;
    if (ref) ref.setAttribute('aria-expanded', 'false');
    popup.hidden = true; active = null; pinned = false;
    if (restoreFocus && ref?.isConnected) {
      suppressFocus = true; ref.focus({preventScroll:true}); suppressFocus = false;
    }
  }
  function open(ref, pin = false) {
    const note = doc.getElementById(ref.dataset.note);
    if (!note) return false;
    clearTimeout(openTimer); clearTimeout(closeTimer);
    if (active && active !== ref) active.setAttribute('aria-expanded', 'false');
    active = ref; pinned = pin;
    title.textContent = `${ref.textContent}. ${note.querySelector('.note-kind')?.textContent || 'Примечание'}`;
    content.innerHTML = note.querySelector('.note-content')?.innerHTML || '';
    for (const el of content.querySelectorAll('[id]')) el.removeAttribute('id');
    fullLink.href = ref.getAttribute('href');
    ref.setAttribute('aria-haspopup', 'dialog'); ref.setAttribute('aria-controls', popup.id); ref.setAttribute('aria-expanded', 'true');
    popup.hidden = false; popup.dataset.pinned = String(pin); position();
    return true;
  }
  const scheduleClose = () => {
    clearTimeout(openTimer); clearTimeout(closeTimer);
    if (!pinned) closeTimer = setTimeout(() => {
      if (!popup.contains(doc.activeElement) && doc.activeElement !== active) close();
    }, 220);
  };
  on(root, 'pointerover', event => {
    if (event.pointerType === 'touch' || pinned) return;
    const ref = refFrom(event.target);
    if (!ref || ref.contains(event.relatedTarget)) return;
    clearTimeout(closeTimer); clearTimeout(openTimer);
    openTimer = setTimeout(() => open(ref), 140);
  });
  on(root, 'pointerout', event => {
    const ref = refFrom(event.target);
    if (ref && !ref.contains(event.relatedTarget) && !popup.contains(event.relatedTarget)) scheduleClose();
  });
  on(popup, 'pointerenter', () => {clearTimeout(closeTimer); clearTimeout(openTimer);});
  on(popup, 'pointerleave', event => {if (!active?.contains(event.relatedTarget)) scheduleClose();});
  on(root, 'focusin', event => {
    const ref = refFrom(event.target);
    if (ref && !suppressFocus && !pinned) open(ref);
  });
  on(root, 'focusout', event => {
    if ((event.target === active || popup.contains(event.target)) && !popup.contains(event.relatedTarget) && event.relatedTarget !== active) scheduleClose();
  });
  on(root, 'click', event => {
    const ref = refFrom(event.target);
    if (!ref || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (active === ref && pinned) {event.preventDefault(); close(); return;}
    if (open(ref, true)) {
      event.preventDefault();
      // Keyboard activation enters the dialog; pointer activation keeps the reading position.
      if (event.detail === 0) closeButton.focus({preventScroll:true});
    }
  });
  on(doc, 'pointerdown', event => {if (!popup.contains(event.target) && !refFrom(event.target)) close();});
  on(doc, 'keydown', event => {if (event.key === 'Escape' && active) {event.preventDefault();close(true);}});
  on(closeButton, 'click', () => close(true));
  on(fullLink, 'click', () => close());
  on(doc, 'kefirt:content-change', () => close());
  on(win, 'resize', position);
  on(doc, 'scroll', event => {if (!popup.contains(event.target)) position();}, {capture:true});
  return () => {close(); abort.abort();};
}

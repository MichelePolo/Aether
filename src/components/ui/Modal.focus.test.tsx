import { useState } from 'react';
import { beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from './Modal';

// jsdom doesn't implement HTMLDialogElement.showModal()/close(), so without this
// polyfill the Modal's mount effect throws and the real close-event path (the
// one the focus-restore fix depends on) never runs. Same base pattern as
// Modal.test.tsx, PLUS: real showModal() also moves focus into the dialog
// (there's no autofocusable descendant here, so the dialog itself becomes the
// focused area). Without simulating that, `trigger` never loses focus in
// jsdom, and the "focus restored to trigger" assertion below would pass
// trivially regardless of whether the restore logic ever runs.
let installedPolyfill = false;

beforeEach(() => {
  if (!(HTMLDialogElement.prototype as unknown as { showModal?: () => void }).showModal) {
    installedPolyfill = true;
    (HTMLDialogElement.prototype as unknown as { showModal: () => void }).showModal = function () {
      const el = this as HTMLDialogElement;
      el.setAttribute('open', '');
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus();
    };
    (HTMLDialogElement.prototype as unknown as { close: () => void }).close = function () {
      (this as HTMLDialogElement).removeAttribute('open');
      (this as HTMLDialogElement).dispatchEvent(new Event('close'));
    };
  }
  document.body.style.overflow = '';
});

afterEach(() => {
  if (installedPolyfill) {
    delete (HTMLDialogElement.prototype as unknown as { showModal?: () => void }).showModal;
    delete (HTMLDialogElement.prototype as unknown as { close?: () => void }).close;
    installedPolyfill = false;
  }
  document.body.style.overflow = '';
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="T">
          <p>body</p>
        </Modal>
      )}
    </>
  );
}

it('restores focus to the trigger after Escape (unmount-based dialog)', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const trigger = screen.getByRole('button', { name: 'open' });
  trigger.focus();
  await user.click(trigger);
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
});

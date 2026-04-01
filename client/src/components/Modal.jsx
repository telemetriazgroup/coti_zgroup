import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

export function Modal({ title, children, footer, onClose, wide, panelClassName = '' }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const node = (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={
          'modal-panel' +
          (wide ? ' modal-panel--wide' : '') +
          (panelClassName ? ` ${panelClassName}` : '')
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-hdr">
          <span className="modal-title" id="modal-title">
            {title}
          </span>
          <button type="button" className="modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-ft">{footer}</div> : null}
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}

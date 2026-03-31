import React from 'react';

/**
 * Texto de ayuda reutilizable: ciclo de vida de la cotización.
 */
export function QuotationEstadosGuideContent() {
  return (
    <div className="status-guide mono" style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--muted)' }}>
      <p style={{ color: 'var(--text)', marginBottom: 12 }}>
        El <strong style={{ color: 'var(--cyan)' }}>estado</strong> refleja en qué fase está la cotización
        técnica-comercial. Avanza el flujo cuando corresponda; en etapas finales el estado queda cerrado.
      </p>

      <h3 className="status-guide__h" style={{ marginTop: 16 }}>
        Carril principal
      </h3>
      <ol className="status-guide__ol">
        <li>
          <strong style={{ color: 'var(--text)' }}>Borrador</strong> — Cotización en elaboración. Puede pasar a{' '}
          <em>En seguimiento</em> manualmente o al agregar la primera línea al presupuesto.
        </li>
        <li>
          <strong style={{ color: 'var(--text)' }}>En seguimiento</strong> — Trabajo activo con el cliente
          (presupuesto, módulos financieros, planos). Cuando envíes la propuesta formal, pasa a{' '}
          <em>Presentada</em>.
        </li>
        <li>
          <strong style={{ color: 'var(--text)' }}>Presentada</strong> — Oferta enviada al cliente. Desde aquí
          puede cerrarse en <em>Aceptada</em> o <em>Rechazada</em>, o entrar en <em>En negociación</em> si
          hay ajustes.
        </li>
        <li>
          <strong style={{ color: 'var(--text)' }}>Aceptada / Rechazada</strong> — Estados finales. No se
          pueden cambiar desde la interfaz (evita inconsistencias con cierre comercial).
        </li>
      </ol>

      <h3 className="status-guide__h" style={{ marginTop: 16 }}>
        Negociación (opcional)
      </h3>
      <p>
        <strong style={{ color: 'var(--text)' }}>En negociación</strong> permite registrar que la oferta
        presentada está en revisión o ajustes. Puedes volver a <em>Presentada</em> tras una nueva ronda,
        o cerrar en <em>Aceptada</em> / <em>Rechazada</em>.
      </p>

      <h3 className="status-guide__h" style={{ marginTop: 16 }}>
        Retrocesos
      </h3>
      <p>
        En algunos casos puedes <strong style={{ color: 'var(--amber)' }}>volver atrás</strong> (por ejemplo
        de «En seguimiento» a «Borrador», o retirar una presentación). Úsalo cuando sea necesario corregir el
        estado sin crear un proyecto nuevo.
      </p>
    </div>
  );
}

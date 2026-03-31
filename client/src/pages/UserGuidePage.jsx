import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const TOC = [
  { id: 'intro', title: 'Introducción' },
  { id: 'roles', title: 'Roles y permisos' },
  { id: 'dashboard', title: 'Dashboard y reportes' },
  { id: 'proyectos', title: 'Proyectos' },
  { id: 'cotizador', title: 'Uso del cotizador' },
  { id: 'pdf', title: 'Exportar PDF' },
  { id: 'planos', title: 'Planos técnicos' },
  { id: 'clientes', title: 'Clientes' },
  { id: 'catalogo', title: 'Catálogo' },
  { id: 'empleados', title: 'Empleados y usuarios' },
  { id: 'tips', title: 'Buenas prácticas' },
];

function GuideSection({ id, title, children }) {
  return (
    <article className="guide-section" id={id}>
      <h2 className="guide-h2">{title}</h2>
      {children}
    </article>
  );
}

function Steps({ items }) {
  return (
    <ol className="guide-steps mono">
      {items.map((t, i) => (
        <li key={i}>{t}</li>
      ))}
    </ol>
  );
}

function TocLink({ id, children }) {
  return (
    <button
      type="button"
      className="guide-toc-link"
      onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
    >
      {children}
    </button>
  );
}

export function UserGuidePage() {
  const { hasRole, user } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const isCommercial = hasRole('COMERCIAL');
  const isViewer = hasRole('VIEWER');

  return (
    <section className="view-active user-guide">
      <div className="page-header page-header--row">
        <div>
          <h1 className="page-title">Guía de usuario</h1>
          <p className="page-sub muted mono">
            ZGROUP Cotizaciones técnicas · uso del sistema paso a paso
          </p>
        </div>
        <Link to="/dashboard" className="btn btn-ghost mono">
          Volver al dashboard
        </Link>
      </div>

      <div className="guide-layout">
        <nav className="guide-toc mono" aria-label="Contenido">
          <div className="guide-toc-title">Contenido</div>
          <ul>
            {TOC.map(({ id, title }) => (
              <li key={id}>
                <TocLink id={id}>{title}</TocLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="guide-body">
          <GuideSection id="intro" title="Introducción">
            <p>
              Esta aplicación permite gestionar <strong>cotizaciones técnicas</strong> (proyectos), clientes,
              catálogo de partidas, planos y análisis financiero. El <strong>cotizador</strong> es la pantalla
              de <strong>Presupuesto</strong> dentro de cada proyecto: ahí se arman las líneas, se calculan
              totales y se configuran los módulos financieros (M1–M5). Los importes se trabajan en{' '}
              <strong>USD</strong>.
            </p>
            <p className="muted mono" style={{ fontSize: 12, marginTop: 8 }}>
              Sesión actual: <strong>{user?.email}</strong>
            </p>
          </GuideSection>

          <GuideSection id="roles" title="Roles y permisos">
            <ul className="guide-list">
              <li>
                <strong className="mono">ADMIN</strong> — Acceso total: usuarios, empleados, catálogo, panel
                gerencial en dashboard, todos los proyectos.
              </li>
              <li>
                <strong className="mono">COMERCIAL</strong> — Sus proyectos, clientes, cotizaciones, catálogo
                (lectura), exportación PDF, mi ficha de empleado.
              </li>
              <li>
                <strong className="mono">VIEWER</strong> — Solo lectura del proyecto asignado (presupuesto y
                planos visibles), sin editar ni exportar PDF según política.
              </li>
            </ul>
          </GuideSection>

          <GuideSection id="dashboard" title="Dashboard y reportes">
            <p>
              En <Link to="/dashboard">Dashboard</Link> verás un resumen según tu rol: número de proyectos
              visibles, clientes y tu rol.
            </p>
            {isAdmin && (
              <>
                <h3 className="guide-h3">Reporte gerencial (solo ADMIN)</h3>
                <Steps
                  items={[
                    'Abre Dashboard desde el menú lateral.',
                    'Revisa los KPIs: pipeline total (suma de listas de proyectos activos), proyectos activos, ratio de cierre (aceptados / total), proyectos aceptados.',
                    'Consulta la tabla «Proyectos por estado» para ver el volumen en Borrador, Seguimiento, Presentada, etc.',
                    'Usa «Record por comercial» para comparar cantidad de proyectos, valor de pipeline y aceptados por persona.',
                  ]}
                />
                <p className="guide-note">
                  Estos datos son orientativos para gestión; el detalle financiero está en cada proyecto
                  (presupuesto y módulos M1–M5).
                </p>
              </>
            )}
            {!isAdmin && (
              <p className="muted">
                Tu dashboard muestra totales acotados a lo que puedes ver. El panel gerencial por comercial
                está reservado a ADMIN.
              </p>
            )}
          </GuideSection>

          <GuideSection id="proyectos" title="Proyectos">
            <Steps
              items={[
                'En Proyectos pulsa «Nuevo proyecto» (si tienes permiso), indica nombre y opcionalmente cliente y referencia Odoo.',
                'Abre un proyecto desde la lista. Desde la cabecera usa el enlace al presupuesto o entra por la navegación interna del proyecto.',
                'Las pestañas «Presupuesto» y «Planos» cambian entre el cotizador y los archivos técnicos.',
              ]}
            />
            <h3 className="guide-h3">Estado de la cotización</h3>
            <p>
              Cada proyecto tiene un <strong>estado</strong> (Borrador → En seguimiento → Presentada →
              Aceptada/Rechazada, con opción de Negociación). En la pantalla de presupuesto verás el carril
              visual y el botón <strong>Guía de ayuda</strong> del flujo. En la lista de proyectos existe
              «Guía de estados» con el detalle.
            </p>
            <p className="muted" style={{ fontSize: 12 }}>
              Al agregar la primera línea al presupuesto, el estado suele pasar automáticamente a «En
              seguimiento».
            </p>
          </GuideSection>

          <GuideSection id="cotizador" title="Uso del cotizador (presupuesto)">
            <p>
              El <strong>cotizador</strong> es la vista <strong>Presupuesto</strong> del proyecto. Sirve para
              montar la propuesta económica: líneas de ítems, totales de lista y motor financiero M1–M5. Todo
              queda guardado en el proyecto (los parámetros financieros se persisten con un pequeño retardo
              al editarlos).
            </p>

            <h3 className="guide-h3">1. Entrar al cotizador</h3>
            <Steps
              items={[
                'Menú Proyectos → abre un proyecto → entra a Presupuesto desde la navegación del proyecto (ruta …/presupuesto).',
                'Arriba verás el nombre del proyecto, el estado de la cotización, la barra de totales (lista, activos, consumibles) y la navegación Presupuesto / Planos.',
              ]}
            />

            <h3 className="guide-h3">2. Panel izquierdo: catálogo</h3>
            <Steps
              items={[
                'Busca por código o descripción (la búsqueda espera un instante; debounce).',
                'Filtra por categoría y por tipo ACTIVO / CONSUMIBLE.',
                'Indica cantidad (y opcionalmente un precio unitario manual si necesitas sobrescribir el del catálogo).',
                'Haz clic en una fila del catálogo para añadir esa partida al presupuesto.',
                '«Pieza personalizada» abre un formulario para ítems que no están en catálogo (código, descripción, unidad, tipo, precio y cantidad).',
              ]}
            />

            <h3 className="guide-h3">3. Tabla de líneas y totales</h3>
            <Steps
              items={[
                'La tabla central lista cada línea: código, descripción, tipo, unidad, precio unitario, cantidad y subtotal.',
                'Edita precio y cantidad en las celdas; los cambios se guardan al dejar de teclear (debounce).',
                '«Quitar» elimina la línea del presupuesto.',
                'El pie y la barra superior muestran ACTIVOS, CONSUMIBLES y TOTAL LISTA (base para el motor financiero).',
                '«Limpiar» vacía todas las líneas (acción destructiva; úsalo con cuidado).',
              ]}
            />

            <h3 className="guide-h3">4. Módulos financieros (M1–M5)</h3>
            <p>
              Debajo de la tabla está el bloque <strong>Módulos financieros</strong>. La <strong>base lista</strong>{' '}
              proviene de la suma de líneas; <strong>M1</strong> aplica el ajuste comercial (margen o descuento)
              y define el <strong>TOTAL VENTA</strong>. Los módulos <strong>M2</strong> (corto plazo),{' '}
              <strong>M3</strong> (largo plazo / sistema francés) y <strong>M4</strong> (estacionalidad, tabla de
              años) se recalculan en cascada según los interruptores CP / LP / Estacionalidad.
            </p>
            <Steps
              items={[
                'Activa o desactiva Corto plazo (CP), Largo plazo (LP) y Estacionalidad según la modalidad que quieras analizar.',
                'M1: elige margen de seguridad o descuento (%) y revisa TOTAL VENTA.',
                'M2: parámetros de arriendo CP (plazos, ROA, merma, etc.) y renta al cliente.',
                'M3: plazos LP, tasas TEA, cuotas, fases F1/F2 y utilidades por fase.',
                'M4: meses operativos/standby, regla de oro y tabla a 5 años.',
                'M5 (panel gerencial): comparativa CP vs LP en el horizonte en meses que indiques; el veredicto y las cifras coinciden con el PDF Gerencia.',
              ]}
            />

            <h3 className="guide-h3">5. Exportar y estado</h3>
            <p>
              El bloque <strong>Exportar PDF</strong> (si tienes permiso) genera informes Gerencia o Cliente;
              véase la sección siguiente. El <strong>estado</strong> de la cotización se gestiona en el carril
              superior (avanzar pasos, negociación, cierre).
            </p>

            {isViewer && (
              <p className="guide-warn">
                Como VIEWER, la interfaz puede ocultar datos sensibles (ROA, spreads, detalles internos); verás
                resúmenes referenciales en algunos acordeones.
              </p>
            )}
            {(isCommercial || isAdmin) && (
              <p className="guide-note">
                Consejo: deja el M5 alineado (horizonte en meses) antes de generar el PDF Gerencia para que el
                informe coincida con lo que revisaste en pantalla.
              </p>
            )}
          </GuideSection>

          <GuideSection id="pdf" title="Exportar PDF (reporte de cotización)">
            <p>
              Desde el presupuesto, si tienes permiso de escritura, aparece el bloque <strong>Exportar PDF</strong>.
            </p>
            <Steps
              items={[
                'Revisa el bloque M5 en módulos financieros para que coincida con lo que quieres en el informe.',
                'Pulsa «PDF Gerencia» para un documento con presupuesto, análisis M1–M5 y panel gerencial.',
                'Pulsa «PDF Cliente» para una versión con totales y referencias comerciales, sin datos internos sensibles (ROA, spreads, etc.).',
                'Espera a que termine la generación (mensaje de estado); al completarse se descargará el archivo.',
              ]}
            />
            <p className="guide-note">
              Si el servidor usa cola (Redis), el proceso puede tardar unos segundos. Si falla, revisa con
              administración la configuración de Chromium o desactiva la cola según documentación de
              despliegue.
            </p>
          </GuideSection>

          <GuideSection id="planos" title="Planos técnicos">
            <Steps
              items={[
                'Entra al proyecto → pestaña Planos.',
                'Arrastra archivos o usa «Seleccionar archivos» (formatos PDF, DWG, DXF, imágenes, etc., según límites del servidor).',
                'Visualiza versiones y previsualiza cuando exista enlace firmado.',
                'Opcional: notas de revisión para cada subida.',
              ]}
            />
          </GuideSection>

          <GuideSection id="clientes" title="Clientes (CRM)">
            <Steps
              items={[
                'En Clientes alta, edición y búsqueda de razón social y datos de contacto.',
                'Al crear o editar un proyecto puedes asociar un cliente existente.',
              ]}
            />
          </GuideSection>

          <GuideSection id="catalogo" title="Catálogo">
            <p>
              El <strong>catálogo</strong> agrupa partidas por categorías (ADMIN puede reorganizar y
              mantener ítems). COMERCIAL usa el catálogo al armar presupuestos desde el panel lateral del
              presupuesto.
            </p>
            <Steps
              items={[
                'ADMIN: crea categorías, ítems, precios y tipos (ACTIVO / CONSUMIBLE).',
                'COMERCIAL: en presupuesto, filtra por categoría o busca por código/descripción y añade a la cotización.',
              ]}
            />
          </GuideSection>

          <GuideSection id="empleados" title="Empleados y usuarios">
            {isAdmin ? (
              <>
                <Steps
                  items={[
                    'Empleados: revisa el listado de fichas; «Nueva ficha» vincula un usuario ADMIN/COMERCIAL que aún no tenga ficha.',
                    'Editar abre el formulario completo (nombres, cargo, contacto, foto por URL, fecha de ingreso, notas).',
                    'Usuarios: crea cuentas, asigna roles (ADMIN, COMERCIAL, VIEWER), importa desde Excel, exporta listado y desactiva cuentas que ya no deban acceder.',
                  ]}
                />
              </>
            ) : (
              <>
                <Steps
                  items={[
                    'Mi ficha: actualiza tus datos personales (cargo, teléfono, DNI, foto por URL, fecha de ingreso, notas).',
                    'La administración de cuentas y el listado de todo el equipo corresponde a usuarios ADMIN.',
                  ]}
                />
                <p className="muted">
                  Si necesitas una ficha de empleado y no aparece, solicita a un administrador que la cree en
                  Empleados.
                </p>
              </>
            )}
          </GuideSection>

          <GuideSection id="tips" title="Buenas prácticas">
            <ul className="guide-list">
              <li>Cierra sesión al terminar en equipos compartidos (icono de salida en la barra lateral).</li>
              <li>
                Mantén los datos del cliente y del proyecto alineados antes de marcar la cotización como
                Presentada o Aceptada.
              </li>
              <li>
                Para dudas sobre el flujo de estados, usa la guía contextual en Presupuesto o en la lista de
                proyectos.
              </li>
              <li>
                Revisa la sección <strong>Uso del cotizador</strong> arriba antes de presentar una oferta: líneas,
                totales y M1–M5 deben ser coherentes con lo que enviarás al cliente.
              </li>
            </ul>
          </GuideSection>

          <p className="muted mono" style={{ fontSize: 11, marginTop: 32 }}>
            Documentación interna sujeta a evolución del producto. Última revisión: interfaz web actual.
          </p>
        </div>
      </div>
    </section>
  );
}

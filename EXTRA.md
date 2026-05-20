# ZGROUP — Documentación extra: roles, permisos y equipos

Complemento de `README.md` y `.cursorrules`. Describe el modelo de **SUPERUSER**, jerarquía de usuarios, **compartir proyectos** y **asignación comerciales → admin**.

---

## Roles del sistema

| Rol | Descripción |
|-----|-------------|
| **SUPERUSER** | Acceso total. Ve todos los proyectos, auditoría global, export/import del sistema. Asigna comerciales a admins. |
| **ADMIN** | Gestiona catálogo, clientes, empleados y usuarios (COMERCIAL/VIEWER). Comparte proyectos propios. Ve proyectos de su equipo comercial. |
| **COMERCIAL** | Crea y edita sus proyectos e ítems de presupuesto. Catálogo en solo lectura. Crea VIEWER. No comparte proyectos. |
| **VIEWER** | Solo lectura del proyecto asignado (`assigned_viewer`). |

---

## Matriz de permisos

| Capacidad | SUPERUSER | ADMIN | COMERCIAL | VIEWER |
|-----------|:---------:|:-----:|:---------:|:------:|
| Ver todos los proyectos | ✓ | — | — | — |
| Ver proyectos propios | ✓ | ✓ | ✓ | — |
| Ver proyectos compartidos | ✓ | ✓ | ✓ | — |
| Ver proyectos del equipo comercial | ✓ | ✓ | — | — |
| Ver proyecto asignado (VIEWER) | ✓ | — | — | ✓ |
| Editar presupuesto / ítems | ✓ | ✓* | ✓* | — |
| CRUD catálogo | ✓ | ✓ | — | — |
| Ver catálogo (lectura) | ✓ | ✓ | ✓ | — |
| Compartir proyecto | ✓ | ✓** | — | — |
| Asignar VIEWER a proyecto | ✓ | ✓** | ✓*** | — |
| Clonar / archivar proyecto | ✓ | ✓** | ✓* | — |
| Auditoría de proyecto | ✓ | — | — | — |
| Export/import sistema | ✓ | — | — | — |
| Asignar comerciales a admin | ✓ | — | — | — |

\* Incluye proyectos propios, compartidos con edición y (solo ADMIN) proyectos de comerciales de su equipo.  
\** Solo en proyectos **propios** del admin (no en proyectos del equipo ni compartidos por otros).  
\*** Solo en proyectos propios del comercial.

---

## Jerarquía de creación de usuarios

Solo se pueden crear usuarios con roles permitidos según quien crea la cuenta. La relación queda registrada en `users.created_by`.

| Creador | Puede crear |
|---------|-------------|
| **SUPERUSER** | ADMIN, COMERCIAL, VIEWER |
| **ADMIN** | COMERCIAL, VIEWER |
| **COMERCIAL** | VIEWER |
| **VIEWER** | — |

Reglas adicionales:

- El **SUPERUSER** es el único que puede crear **ADMIN**.
- Un **ADMIN** ve y gestiona usuarios que él creó y comerciales asignados por el superusuario.
- Un **COMERCIAL** solo ve y gestiona los **VIEWER** que él creó.
- Import/export Excel de usuarios: solo **ADMIN** y **SUPERUSER**.

API: `GET /api/users/allowed-roles` devuelve los roles que el usuario autenticado puede asignar al crear.

---

## Visibilidad de proyectos (ADMIN)

Un administrador ve proyectos en cuatro categorías (`accessKind` en la API):

| `accessKind` | Significado |
|--------------|-------------|
| `own` | Proyecto creado por el admin |
| `shared` | Proyecto de otro usuario compartido explícitamente con el admin |
| `team` | Proyecto de un comercial de su equipo |
| `other` | Solo visible para SUPERUSER (todos los proyectos) |

**Equipo comercial de un ADMIN** = comerciales que cumplen **al menos una** de:

1. Fueron **creados por ese admin** (`users.created_by = admin.id`).
2. Fueron **asignados por el superusuario** (tabla `admin_commercial_assignments`).

El admin tiene **lectura y escritura** sobre proyectos del equipo (igual que si fueran compartidos con permiso de edición), pero **no** puede compartirlos ni archivarlos: esas acciones requieren ser dueño del proyecto.

---

## Compartir proyectos

Tabla: `project_shares` — vincula un proyecto con uno o más usuarios (ADMIN o COMERCIAL) con acceso de **edición**.

| Campo | Descripción |
|-------|-------------|
| `project_id` | Proyecto compartido |
| `user_id` | Usuario con acceso |
| `shared_by` | Quién realizó el share |

### UI

En **Proyectos → Compartir** (solo ADMIN/SUPERUSER, solo proyectos propios):

- Buscador por email o nombre (`GET /api/users/shareable?q=...`).
- Selección múltiple con checkboxes y chips de usuarios elegidos.
- Guardar reemplaza la lista completa de colaboradores.

### API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/projects/:id/shares` | Lista colaboradores actuales |
| `PUT` | `/api/projects/:id/shares` | Body: `{ userIds: [uuid, ...] }` — reemplaza shares |
| `GET` | `/api/users/shareable?q=` | Busca ADMIN/COMERCIAL activos (máx. 50) |

Eventos de auditoría: `PROJECT_SHARE`, `PROJECT_UNSHARE` (solo consultables por SUPERUSER).

---

## Asignación comerciales → admin

Solo el **SUPERUSER** gestiona qué comerciales pertenecen al equipo de cada administrador.

Tabla: `admin_commercial_assignments`

| Campo | Descripción |
|-------|-------------|
| `admin_id` | Administrador |
| `commercial_id` | Comercial asignado |
| `assigned_by` | Superusuario que hizo la asignación |

### UI

Ruta: **`#/superusuario/asignaciones`**  
Menú lateral (superusuario): **Asignar comerciales**

- Lista de admins con sus comerciales actuales.
- Modal con buscador y checkboxes para seleccionar uno o más comerciales.

### API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/admin-assignments` | Admins + comerciales asignados + listado global de comerciales |
| `PUT` | `/api/admin-assignments/:adminId` | Body: `{ commercialIds: [uuid, ...] }` — reemplaza asignaciones |

Consulta auxiliar para admins: `GET /api/users/managed-commercials` — comerciales de su equipo (creados + asignados).

---

## SUPERUSER — panel de sistema

Ruta: **`#/superusuario`**

| Función | API |
|---------|-----|
| Auditoría global | `GET /api/superuser/audit?limit=` |
| Export JSON completo | `GET /api/superuser/export` |
| Import JSON (preview/apply) | `POST /api/superuser/import/preview`, `POST /api/superuser/import/apply` |

En la lista de proyectos, el superusuario ve la columna **Creador** y puede abrir el historial de auditoría por proyecto.

---

## Usuarios — rutas API relevantes

| Método | Ruta | Roles | Descripción |
|--------|------|-------|-------------|
| `GET` | `/api/users` | ADMIN, COMERCIAL, SUPERUSER | Lista filtrada por jerarquía |
| `GET` | `/api/users/allowed-roles` | Todos autenticados | Roles que puede crear |
| `GET` | `/api/users/shareable` | ADMIN, SUPERUSER | Búsqueda para compartir proyecto |
| `GET` | `/api/users/managed-commercials` | ADMIN, SUPERUSER | Equipo comercial del admin |
| `GET` | `/api/users/viewers` | ADMIN, COMERCIAL, SUPERUSER | VIEWER para asignar a proyectos |
| `POST` | `/api/users` | ADMIN, COMERCIAL, SUPERUSER | Alta con `created_by` |
| `PUT` | `/api/users/:id` | Según jerarquía | Edición / desactivación |
| `DELETE` | `/api/users/:id` | ADMIN, COMERCIAL, SUPERUSER | Soft delete (desactivar) |

---

## Rutas frontend

| Ruta | Acceso | Contenido |
|------|--------|-----------|
| `#/users` | ADMIN, COMERCIAL, SUPERUSER | Gestión de usuarios según jerarquía |
| `#/superusuario` | SUPERUSER | Backup, auditoría, import/export |
| `#/superusuario/asignaciones` | SUPERUSER | Asignar comerciales a admins |
| `#/projects` | Todos (según rol) | Lista con etiquetas Propio / Compartido / Equipo |

---

## Base de datos — tablas y columnas nuevas

Migraciones: `005_superuser_sharing.sql`, `006_admin_team.sql`

```text
users.created_by          → UUID (FK users) — quién creó la cuenta

project_shares            → project_id, user_id, shared_by
admin_commercial_assignments → admin_id, commercial_id, assigned_by

project_items.created_by  → UUID — autor de cada línea de presupuesto

user_role enum            → valor SUPERUSER
audit_event enum          → PROJECT_SHARE, PROJECT_UNSHARE
```

---

## Credenciales de desarrollo (seed)

Tras `npm run seed`:

| Rol | Email | Contraseña (por defecto) |
|-----|-------|---------------------------|
| SUPERUSER | `zgroup@zgroup.pe` | `ZGroup2025!` |
| ADMIN | `admin@zgroup.pe` | `ZGroup2025!` |
| COMERCIAL | `comercial@zgroup.pe` | `ZGroup2025!` |

Variables en `.env`: `SUPERUSER_EMAIL`, `SUPERUSER_PASSWORD`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`.

---

## Archivos de referencia en el código

| Área | Archivo |
|------|---------|
| Roles (servidor) | `server/utils/userRoles.js` |
| Acceso a proyectos | `server/utils/projectAccess.js`, `server/utils/projectHelpers.js` |
| Creación de usuarios | `server/lib/userCreation.js` |
| Equipo admin | `server/lib/adminTeam.js` |
| Rutas usuarios | `server/routes/users.js` |
| Rutas asignaciones | `server/routes/adminAssignments.js` |
| Rutas superusuario | `server/routes/superuser.js` |
| Roles (cliente) | `client/src/lib/userRoles.js` |
| UI compartir | `client/src/pages/ProjectsPage.jsx` |
| UI asignaciones | `client/src/pages/AdminAssignmentsPage.jsx` |
| UI usuarios | `client/src/pages/UsersPage.jsx` |

---

## Flujo recomendado de configuración

1. Iniciar sesión como **superusuario** (`zgroup@zgroup.pe`).
2. Crear **ADMIN** y **COMERCIAL** en **Usuarios** (o usar seed).
3. En **Asignar comerciales**, vincular comerciales a cada admin que deba supervisarlos.
4. Cada **ADMIN** crea comerciales adicionales si lo necesita; esos quedan automáticamente en su equipo.
5. Los **ADMIN** comparten proyectos propios con otros usuarios desde **Proyectos → Compartir**.
6. Los **COMERCIAL** crean **VIEWER** y los asignan a proyectos desde **Proyectos → Asignar viewer**.

---

## Solicitudes de catálogo (aprobación)

Los **COMERCIAL** no pueden crear ni editar ítems del catálogo directamente. En su lugar envían **solicitudes** que revisa su **ADMIN** (equipo comercial) o el **SUPERUSER**.

### Tipos de solicitud

| Tipo | Descripción |
|------|-------------|
| `CREATE` | Alta de un ítem nuevo (código, nombre, precio, categoría) |
| `UPDATE` | Cambio de **nombre/descripción** o **precio unitario** de un ítem existente |

Estados: `PENDING` → `APPROVED` | `REJECTED`

Al aprobar, el revisor puede **corregir** cualquier campo antes de publicar. El ítem queda disponible de inmediato en el catálogo (sidebar de presupuesto).

### UI

| Ubicación | Acción |
|-----------|--------|
| **Catálogo → Solicitudes** | Cola de aprobación (admin) o envío / historial (comercial) |
| **Presupuesto → sidebar Catálogo** | Comercial: botones *Solicitar ítem* y *Cambio precio/nombre* |
| **Menú lateral → Catálogo** | Badge con cantidad de solicitudes pendientes (admin) |

### API

| Método | Ruta | Rol | Descripción |
|--------|------|-----|-------------|
| `POST` | `/api/catalog/requests` | COMERCIAL | Crear solicitud CREATE o UPDATE |
| `GET` | `/api/catalog/requests` | ADMIN, COMERCIAL, SUPERUSER | Listar (filtrado por jerarquía) |
| `GET` | `/api/catalog/requests/pending-count` | ADMIN, SUPERUSER | Contador para badge |
| `PUT` | `/api/catalog/requests/:id/approve` | ADMIN, SUPERUSER | Aprobar (body opcional con correcciones) |
| `PUT` | `/api/catalog/requests/:id/reject` | ADMIN, SUPERUSER | Rechazar con notas |

Tabla: `catalog_item_requests` (migración `007_catalog_requests.sql`).

---

## Compartir proyecto desde el presupuesto

Mientras se trabaja en un proyecto (**Presupuesto**), el botón **Compartir** aparece junto al **Estado de la cotización** (misma fila que *Guía de ayuda*).

- Visible solo para **ADMIN** o **SUPERUSER** dueños del proyecto.
- Mismo modal de búsqueda multi-usuario que en la lista de proyectos.
- Muestra contador de colaboradores actuales: `Compartir (N)`.

Componente reutilizable: `client/src/components/ProjectShareModal.jsx`.

---

## Historial de cambios en catálogo

Admin y superusuario pueden ver el **historial de modificaciones** de cada ítem y categoría.

### Qué se registra

Cada cambio de campo genera una fila en `catalog_change_log`:

| Campo ítem | Campo categoría |
|------------|-----------------|
| Precio unitario | Nombre |
| Descripción / nombre | Orden |
| Código | Estado activo |
| Unidad, tipo, categoría | |
| Estado activo | |

Origen del cambio (`change_source`):

- `DIRECT` — edición manual por admin/superusuario
- `REQUEST_APPROVED` — solicitud comercial aprobada

### UI

En **Catálogo**, botón **Historial** en cada ítem y categoría (solo admin). Modal con:

- **Ciclo de precio** — cadena visual (ej. 10.00 → 8.00 → 6.00) con fecha y autor
- **Ciclo de nombre/descripción** — igual para cambios de texto
- Filtro por campo y línea de tiempo completa

### API

| Método | Ruta |
|--------|------|
| `GET` | `/api/catalog/items/:id/history` |
| `GET` | `/api/catalog/categories/:id/history` |

Tabla: `catalog_change_log` — migración `008_catalog_change_log.sql`.

---

## Modo enfoque en presupuesto / planos

Al entrar a **`#/projects/:id/presupuesto`** o **`#/projects/:id/planos`**:

1. El **menú lateral se oculta automáticamente** para maximizar espacio de trabajo.
2. Aparece un botón **verde «Módulos»** fijo al borde izquierdo.
3. Al pulsarlo, se restaura el navbar para cambiar de módulo (Dashboard, Proyectos, Catálogo, etc.).

Al salir del presupuesto/planos, el sidebar vuelve según la preferencia guardada del usuario.

---

## Archivos adicionales (catálogo y share)

| Área | Archivo |
|------|---------|
| Rutas solicitudes catálogo | `server/routes/catalogRequests.js` |
| UI solicitudes | `client/src/components/CatalogRequestsPanel.jsx` |
| UI compartir (modal) | `client/src/components/ProjectShareModal.jsx` |
| Historial catálogo | `client/src/components/CatalogHistoryModal.jsx`, `server/lib/catalogChangeLog.js` |
| Share en presupuesto | `client/src/pages/ProjectBudgetPage.jsx`, `QuotationStatusFlow.jsx` |
| Modo enfoque sidebar | `client/src/layout/AppShell.jsx` |

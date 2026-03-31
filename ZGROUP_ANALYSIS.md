# ZGROUP — Análisis Completo de Implicancias del Sistema de Cotizaciones

> **Versión:** 1.0  
> **Fecha:** 2026-03-31  
> **Autor:** Análisis técnico generado para el equipo ZGROUP  
> **Alcance:** Sistema de gestión de cotizaciones técnicas para refrigeración industrial

---

## 1. VISIÓN GENERAL DEL SISTEMA

El sistema **ZGROUP Cotizaciones Técnicas** pasa de ser una herramienta individual (HTML monolítico + localStorage) a una **plataforma multiusuario colaborativa** con trazabilidad completa, exportación profesional y análisis financiero avanzado.

### 1.1 Actores del sistema

| Rol | Descripción | Capacidades clave |
|-----|-------------|-------------------|
| **ADMIN** | Gerencia / dirección técnica | Todo: catálogo, usuarios, panel gerencial, auditoría |
| **COMERCIAL** | Vendedor técnico | Crear cotizaciones, gestionar sus proyectos, exportar |
| **VIEWER** | Cliente externo o interno | Solo ver la cotización asignada (read-only) |

### 1.2 Flujo de vida de una cotización

```
[BORRADOR] → [EN SEGUIMIENTO] → [PRESENTADA] → [ACEPTADA] ──→ [PROYECTO REAL]
                                              ↘ [RECHAZADA]
                                              ↘ [EN NEGOCIACIÓN] → loop
```

Cada transición de estado queda registrada en `project_audit_log` con timestamp, actor y diff de cambios.

---

## 2. ARQUITECTURA TÉCNICA

### 2.1 Stack recomendado (pragmático/evolutivo)

```
┌─────────────────────────────────────────────────────┐
│  FRONTEND                                           │
│  HTML5 + Vanilla JS (preserva diseño v6.0)          │
│  ↓ migración futura: React 18 + Vite + TypeScript   │
├─────────────────────────────────────────────────────┤
│  BACKEND                                            │
│  Node.js 20 + Express 4                             │
│  JWT Auth (access 15min + refresh 7d)               │
│  Multer (file uploads) + Sharp (image preview)      │
├─────────────────────────────────────────────────────┤
│  BASE DE DATOS                                      │
│  PostgreSQL 15 (principal)                          │
│  Redis (sesiones, job queue, cache catálogo)        │
├─────────────────────────────────────────────────────┤
│  ALMACENAMIENTO                                     │
│  MinIO / AWS S3 (planos técnicos)                   │
├─────────────────────────────────────────────────────┤
│  WORKERS                                            │
│  BullMQ (generación asíncrona de PDFs)              │
│  Puppeteer / Playwright (render PDF)                │
└─────────────────────────────────────────────────────┘
```

### 2.2 Estructura de directorios del proyecto

```
zgroup-platform/
├── server/
│   ├── index.js                  # Entry point Express
│   ├── config/
│   │   ├── db.js                 # Pool PostgreSQL
│   │   ├── redis.js              # Cliente Redis
│   │   └── s3.js                 # Cliente MinIO/S3
│   ├── middleware/
│   │   ├── auth.js               # Verificar JWT
│   │   ├── roles.js              # Guard por rol
│   │   └── audit.js              # Interceptor de auditoría
│   ├── routes/
│   │   ├── auth.js               # /api/auth
│   │   ├── users.js              # /api/users
│   │   ├── employees.js          # /api/employees
│   │   ├── clients.js            # /api/clients
│   │   ├── projects.js           # /api/projects
│   │   ├── catalog.js            # /api/catalog
│   │   ├── plans.js              # /api/projects/:id/plans
│   │   ├── snapshots.js          # /api/projects/:id/snapshots
│   │   └── export.js             # /api/export
│   ├── workers/
│   │   └── pdf.worker.js         # BullMQ PDF job
│   ├── services/
│   │   ├── finance.service.js    # Wrapper del finance-engine
│   │   ├── pdf.service.js        # Puppeteer render
│   │   └── storage.service.js    # S3/MinIO ops
│   └── db/
│       ├── schema.sql            # DDL completo
│       └── seed.js               # Datos iniciales (catálogo, admin)
├── shared/
│   └── finance-engine.js         # Motor financiero puro (portable)
├── public/
│   ├── login.html                # Pantalla de acceso
│   ├── app.html                  # Shell principal
│   └── js/
│       ├── auth.js               # Login / tokens / interceptors
│       ├── api.js                # Fetch wrapper con refresh
│       ├── router.js             # Hash router (#/projects, etc.)
│       ├── catalog.js            # Módulo catálogo
│       ├── budget.js             # Módulo presupuesto
│       ├── financial.js          # Módulos financieros M1-M5
│       ├── plans.js              # Módulo planos técnicos
│       ├── export.js             # Exportación
│       └── admin/
│           ├── users.js          # Gestión usuarios
│           ├── catalog-admin.js  # CRUD catálogo
│           └── dashboard.js      # Panel gerencial global
├── package.json
├── .env.example
└── docker-compose.yml
```

---

## 3. MODELO DE DATOS (PostgreSQL)

### 3.1 Entidades principales

```sql
-- Usuarios del sistema (ADMIN, COMERCIAL, VIEWER)
users (id, email, password_hash, role, employee_id, created_at, active)

-- Datos del empleado (comercial o admin)
employees (id, user_id, nombres, apellidos, cargo, telefono, foto_url, 
           dni, fecha_ingreso, created_at)

-- Clientes de ZGROUP
clients (id, razon_social, ruc, contacto_nombre, contacto_email, 
         contacto_telefono, direccion, ciudad, notas, 
         created_by, created_at, updated_at)

-- Proyectos de cotización
projects (id, nombre, odoo_ref, client_id, status, 
          assigned_user_id,   -- VIEWER asignado
          created_by,         -- COMERCIAL dueño
          currency, tc,       -- USD/PEN, tipo de cambio
          finance_params,     -- JSONB con todos los parámetros
          deleted_at,         -- soft delete
          created_at, updated_at)

-- Ítems del presupuesto de un proyecto
project_items (id, project_id, catalog_item_id, 
               codigo, descripcion, unidad, tipo,
               unit_price, qty, subtotal,
               is_custom,      -- pieza personalizada
               sort_order, created_at)

-- Catálogo maestro (solo ADMIN puede editar)
catalog_categories (id, nombre, sort_order, active)

catalog_items (id, category_id, codigo, descripcion, unidad, 
               tipo,           -- ACTIVO | CONSUMIBLE
               unit_price, active, sort_order, 
               created_by, updated_at)

-- Planos técnicos con trazabilidad
project_plans (id, project_id, nombre_original, s3_key, s3_bucket,
               mime_type, size_bytes, version, is_current,
               uploaded_by, uploaded_at, notas_revision)

-- Snapshots de presupuesto congelado
project_budget_snapshots (id, project_id, kind, -- CLIENTE|GERENCIA|INTERNO
                           label, payload,       -- JSONB
                           created_by, created_at)

-- Log de auditoría
project_audit_log (id, project_id, event_type, actor_id, 
                   prev_data, new_data, -- JSONB diff
                   created_at)

-- Tokens de refresco activos
refresh_tokens (id, user_id, token_hash, expires_at, 
                created_at, revoked_at)
```

### 3.2 Diagrama de relaciones (simplificado)

```
users ──────── employees
  │                │
  │                └── projects.created_by
  │
  ├── projects.assigned_user_id (VIEWER)
  │
clients ────────── projects.client_id
                        │
                        ├── project_items
                        ├── project_plans
                        ├── project_budget_snapshots
                        └── project_audit_log
```

---

## 4. MÓDULOS FUNCIONALES

### 4.1 Módulo Auth (M0)
- Login con email/password → JWT access (15min) + refresh httpOnly cookie (7d)
- Middleware `requireAuth` y `requireRole(...roles)` en todas las rutas protegidas
- Broadcast Channel para sincronizar logout entre pestañas
- Pantalla de login con el branding ZGROUP (misma paleta dark)

### 4.2 Módulo Usuarios y Empleados
- ADMIN gestiona usuarios: crear, editar, desactivar
- Al crear un usuario COMERCIAL/ADMIN → se crea también registro `employees`
- Perfil de empleado: foto, cargo, teléfono, historial de cotizaciones
- KPIs por comercial: cotizaciones creadas, aceptadas, valor total, ratio cierre

### 4.3 Módulo Clientes (CRM básico)
- CRUD completo por ADMIN y COMERCIAL
- Búsqueda por razón social, RUC, contacto
- Al crear proyecto, se puede vincular cliente existente o crear nuevo inline
- El campo `odoo_ref` del proyecto mapea al número de cotización en Odoo
- VIEWER no accede al CRM

### 4.4 Módulo Proyectos
- Estados: `BORRADOR` → `EN_SEGUIMIENTO` → `PRESENTADA` → `ACEPTADA` / `RECHAZADA`
- COMERCIAL ve solo sus proyectos; ADMIN ve todos
- Clonar proyecto: copia ítems, parámetros y cliente; NO copia planos
- Soft delete: `deleted_at` timestamp; ADMIN puede listar eliminados

### 4.5 Módulo Catálogo (solo ADMIN)
- CRUD categorías: nombre, orden, activo/inactivo
- CRUD ítems: código, descripción, unidad, tipo (ACTIVO/CONSUMIBLE), precio, categoría
- 55 ítems iniciales migrados desde el HTML v6.0 (via seed)
- Caché en Redis (TTL 24h), invalidar al editar

### 4.6 Módulo Presupuesto
- Panel izquierdo: catálogo filtrable con búsqueda (debounce 200ms)
- Panel central: tabla de ítems con edición inline
- Cantidades decimales permitidas (ej: 0.5m lineales)
- Pieza personalizada: código libre + nombre + tipo + precio
- Persistencia en BD con debounce 300ms (no solo memoria)

### 4.7 Módulos Financieros (M1–M4)
- **M1 Venta Directa**: margen de seguridad o descuento comercial
- **M2 Corto Plazo**: capital ZGROUP, ROA, depreciación, merma
- **M3 Largo Plazo**: sistema francés, 2 fases, fondo de reposición
- **M4 Estacionalidad**: tabla 5 años, Regla de Oro
- Aplicación selectiva: el comercial activa uno o varios modos simultáneos
- El motor `finance-engine.js` es puro e isomórfico (mismo código en front y back)

### 4.8 Módulo Planos Técnicos
- Upload drag & drop (PDF, DWG, DXF, PNG, JPG, SVG; max 25MB)
- Trazabilidad de versiones: cada upload incrementa `version`, el anterior queda como `is_current=false`
- Al cliente (VIEWER) solo se muestra el plano con `is_current=true` y version mayor
- URLs firmadas S3 con TTL 15 minutos para descarga segura
- Preview de imágenes en nueva pestaña

### 4.9 Módulo Exportación PDF
- **Reporte Gerencia**: todos los parámetros financieros + Panel Gerencial + logo ZGROUP
- **Reporte Cliente**: vista simplificada (solo totales por modalidad + plano final) + logo ZGROUP
- Generación asíncrona con BullMQ; polling cada 2s; descarga automática
- Formato definido en MODULES.md (4+ páginas)
- El reporte cliente NO muestra márgenes, ROA, ni datos internos ZGROUP

### 4.10 Panel Gerencial (M5 - solo ADMIN)
- Comparativa CP vs LP para el proyecto activo
- Dashboard global: KPIs de todos los comerciales, cotizaciones aceptadas, valor total del pipeline
- Gráfico de proyecciones de ganancia (horizonte configurable 1-120 meses)
- Record por comercial: proyectos, cierre, valor promedio

---

## 5. CONSIDERACIONES DE SEGURIDAD

### 5.1 Autenticación y sesiones
- Passwords con bcrypt (cost factor 12)
- JWT access token en memoria (NO localStorage) para evitar XSS
- Refresh token en cookie httpOnly + sameSite=strict
- Rate limiting en `/api/auth/login`: 5 intentos / 15 min por IP
- CSRF token para operaciones de escritura (si se usa cookie)

### 5.2 Autorización
- Middleware de roles aplicado en CADA ruta, no solo en UI
- VIEWER: validar en backend que el `project_id` solicitado tiene `assigned_user_id = req.user.id`
- COMERCIAL: validar que el proyecto pertenece a `created_by = req.user.id` en escrituras
- ADMIN: sin restricciones de propiedad pero con log de auditoría

### 5.3 Manejo de archivos
- Validación MIME type en servidor (no confiar en extensión del cliente)
- Archivos subidos a S3 con nombre UUID (no nombre original del archivo)
- DWG/DXF solo almacenados, nunca parseados
- Límite estricto de 25MB en Multer antes de llegar a S3

### 5.4 Datos sensibles
- RUC, teléfonos, emails de clientes: proteger con HTTPS obligatorio
- Parámetros financieros internos (ROA, márgenes): NO exponer a VIEWER en ninguna respuesta API
- Serializar objetos de respuesta con campos explícitos (no `SELECT *`)

### 5.5 Auditoría
- Todo cambio a proyecto, ítems, parámetros queda en `project_audit_log`
- Los logs son append-only (no se pueden eliminar, ni siquiera por ADMIN)
- Almacenar IP y User-Agent en logs críticos

---

## 6. CONSIDERACIONES DE NEGOCIO

### 6.1 Integración con Odoo
- El campo `odoo_ref` es de texto libre (no hay API de Odoo en scope inicial)
- El comercial ingresa manualmente el número de cotización Odoo
- Mejora futura: webhook Odoo → actualizar estado del proyecto automáticamente

### 6.2 Multi-moneda
- USD como moneda base del sistema
- PEN con tipo de cambio configurable por proyecto
- Finance engine trabaja en USD; conversión solo para display

### 6.3 Regla de Oro (Estacionalidad)
- Es una invariante de negocio crítica: `sum(UtilNeta 5 años) = Total_Ciclo_LP × seasonalRatio`
- Tolerancia ±$1 aceptada por redondeo
- Debe validarse en el backend al guardar parámetros de estacionalidad

### 6.4 Trazabilidad de planos
- Un proyecto puede tener N versiones de un plano
- El VIEWER solo ve la versión `is_current=true` con mayor número de versión
- El ADMIN y COMERCIAL ven el historial completo con fechas y notas de revisión
- Esta trazabilidad es clave para proyectos con modificaciones iterativas

### 6.5 Estados de cotización y workflow
- `BORRADOR`: se puede editar todo; no visible para VIEWER
- `EN_SEGUIMIENTO`: el presupuesto tiene al menos 1 ítem; VIEWER puede ver
- `PRESENTADA`: snapshot `CLIENTE` generado y enviado; edición libre para ajustes
- `ACEPTADA`: snapshot final bloqueado; solo ADMIN puede modificar
- `RECHAZADA`: soft delete lógico del proceso; mantiene historial

---

## 7. IMPLICANCIAS DE MIGRACIÓN

### 7.1 Del HTML monolítico al sistema multi-usuario
- Los 55 ítems del catálogo deben migrar desde el código JS del HTML a la tabla `catalog_items`
- Los parámetros financieros (hardcoded en HTML) se convierten en JSONB editable por proyecto
- LocalStorage desaparece; todo persiste en PostgreSQL
- La lógica del `finance-engine` ya es pura y portable (no requiere cambios)

### 7.2 Datos actuales
- No hay datos de usuarios ni proyectos en producción (la herramienta era personal)
- El seed inicial crea: 1 admin, 4 categorías, 55 ítems del catálogo
- Los proyectos existentes en localStorage de los comerciales se perderán (no hay migración de localStorage)

### 7.3 Cambios de paradigma para el comercial
- Antes: abría el HTML y todo era local e inmediato
- Ahora: requiere login, los datos viajan al servidor, hay latencia
- Mitigación: optimistic UI updates + React Query / fetch con caché local

---

## 8. CONSIDERACIONES DE ESCALABILIDAD

### 8.1 Volumen esperado
- ~10-50 usuarios concurrentes (empresa mediana)
- ~500-2000 proyectos/año
- ~50-100 planos por proyecto (máx)
- PDFs generados: ~5-20/día

### 8.2 Puntos de presión
| Componente | Riesgo | Mitigación |
|-----------|--------|------------|
| Generación PDF | CPU intensivo, bloquea server | BullMQ workers separados |
| S3 uploads | Latencia en uploads grandes | Multipart upload + progress streaming |
| Finance engine | Cálculo intensivo para N ítems grandes | Worker thread o Web Worker |
| Catálogo | Query frecuente | Redis cache TTL 24h |

### 8.3 Infraestructura mínima (producción)
- 1 servidor Node.js (2 vCPU, 4GB RAM)
- 1 PostgreSQL (managed o RDS)
- 1 Redis (ElastiCache o Docker)
- 1 MinIO (self-hosted) o AWS S3

---

## 9. RIESGOS Y MITIGACIONES

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|--------|-------------|---------|------------|
| R1 | Pérdida de datos en migración | Media | Alto | Seed con los 55 ítems; backup localStorage si existe |
| R2 | Error en finance engine post-migración | Baja | Crítico | Test suite con 95%+ coverage antes de migrar |
| R3 | Permisos mal configurados (VIEWER ve datos de otro) | Media | Alto | Tests de integración de seguridad por rol |
| R4 | PDFs lentos o que fallan | Media | Medio | Job queue + retry + timeout explícito |
| R5 | Pérdida de planos en S3 | Baja | Alto | Bucket versioning habilitado + backup policy |
| R6 | Token JWT comprometido | Baja | Alto | Access token corto (15min) + refresh httpOnly |
| R7 | Diseño UI roto al añadir nuevas vistas | Alta | Medio | CSS custom properties + design tokens documentados |

---

## 10. DEUDA TÉCNICA CONOCIDA

1. **Frontend framework**: El HTML/JS vanilla escala mal para vistas complejas. Migración a React 18 + Vite está planificada como fase 2.
2. **Finance engine en JS**: Está escrito en TypeScript pero se usa compilado a JS. Agregar `tsc` al build pipeline.
3. **No hay tests E2E**: Playwright para los flujos críticos (login, crear cotización, exportar PDF).
4. **Redis como opcional**: Sprint 0 puede funcionar sin Redis (sin caché, sin jobs) usando in-memory + sync PDF.
5. **Sin internacionalización**: Todo en español; si se escala a otros países, necesitará i18n.

---

## 11. ESTÁNDARES DE CÓDIGO

### 11.1 Convenciones
- **Variables/funciones**: camelCase
- **Clases/interfaces**: PascalCase
- **Constantes**: UPPER_SNAKE_CASE
- **Tablas BD**: snake_case
- **Rutas API**: kebab-case (`/api/catalog-items`, no `/api/catalogItems`)

### 11.2 Estructura de respuesta API
```json
{
  "success": true,
  "data": { ... },
  "meta": { "total": 55, "page": 1 }
}

{
  "success": false,
  "error": { "code": "UNAUTHORIZED", "message": "Token inválido" }
}
```

### 11.3 Códigos de error HTTP
- `200` OK
- `201` Created (POST exitoso)
- `400` Bad Request (validación)
- `401` Unauthorized (sin token o token inválido)
- `403` Forbidden (token válido pero sin permisos)
- `404` Not Found
- `409` Conflict (duplicado)
- `500` Internal Server Error

### 11.4 Finance Engine — Reglas de oro
- **Sin efectos secundarios**: función pura `compute(items, params) → output`
- **Sin I/O**: no fetch, no fs, no DOM
- **Determinismo**: mismo input siempre produce mismo output
- **Cobertura tests ≥ 95%** antes de usar en producción

---

## 12. CHECKLIST DE LANZAMIENTO (Go-Live)

- [ ] Todos los módulos de sprints 0-6 completados y probados
- [ ] Finance engine con test suite ≥ 95% coverage
- [ ] Tests de seguridad por rol (ADMIN/COMERCIAL/VIEWER)
- [ ] Backup de PostgreSQL configurado (daily snapshots)
- [ ] SSL/TLS configurado (Let's Encrypt o ACM)
- [ ] Variables de entorno en servidor (nunca en código)
- [ ] Rate limiting activo en endpoints de auth
- [ ] S3 bucket versioning habilitado
- [ ] Redis con AOF persistence habilitado
- [ ] Logs de error centralizados (Sentry o similar)
- [ ] seed.js ejecutado con catálogo de 55 ítems
- [ ] Usuario admin inicial creado con password seguro
- [ ] Documentación de uso entregada a comerciales

---

*Documento vivo — actualizar conforme avanza el desarrollo.*

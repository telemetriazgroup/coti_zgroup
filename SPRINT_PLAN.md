# ZGROUP — Plan de Desarrollo por Sprints

> **Metodología:** Scrum adaptado (sprints de 2 semanas)  
> **Equipo mínimo:** 1 desarrollador fullstack + 1 QA  
> **Duración total estimada:** 14-16 semanas (7-8 sprints)  
> **Stack:** Node.js + Express + PostgreSQL + Vanilla JS (HTML preservando diseño v6.0)

---

## SPRINT 0 — Fundación + Auth + Roles
**Duración:** 2 semanas | **Prioridad:** CRÍTICA  
**Objetivo:** Sistema base funcionando con login, roles y estructura de proyecto.

### Entregables
- [x] Estructura de directorios del proyecto (`/server`, `/public`, `/shared`)
- [x] `package.json` con dependencias core (express, pg, jsonwebtoken, bcrypt, dotenv)
- [x] `db/schema.sql` — DDL completo: users, employees, refresh_tokens
- [x] `db/seed.js` — Usuario admin inicial + catálogo completo (55 ítems)
- [x] `server/config/db.js` — Pool de conexiones PostgreSQL
- [x] `server/middleware/auth.js` — Verificar JWT access token
- [x] `server/middleware/roles.js` — Guard `requireRole('ADMIN', 'COMERCIAL')`
- [x] `server/routes/auth.js` — POST /login, POST /refresh, POST /logout
- [x] `server/routes/users.js` — CRUD usuarios (solo ADMIN)
- [x] `public/login.html` — Pantalla de login (branding ZGROUP, dark theme)
- [x] `public/app.html` — Shell principal con nav lateral por rol
- [x] `public/js/auth.js` — Manejo de tokens, interceptors, logout
- [x] `public/js/api.js` — Fetch wrapper con auto-refresh de token
- [x] `public/js/router.js` — Hash router (#/dashboard, #/projects, etc.)

### Criterios de aceptación
- Login exitoso redirige al workspace según rol
- Login fallido muestra error "Credenciales incorrectas"
- Token expirado → refresh automático invisible al usuario
- Logout limpia tokens y redirige a /login
- VIEWER sin acceso a rutas de ADMIN o COMERCIAL (403)
- Rate limiting en login: 5 intentos / 15min por IP

### Dependencias técnicas
```
express, pg, jsonwebtoken, bcrypt, cookie-parser, cors, 
express-rate-limit, dotenv, nodemon (dev)
```

---

## SPRINT 1 — Empleados + Clientes + Proyectos Base
**Duración:** 2 semanas | **Prioridad:** ALTA  
**Objetivo:** CRUD completo de las entidades de negocio principales.

### Entregables
- [ ] `db/schema.sql` ampliado: employees, clients, projects (sin ítems aún)
- [ ] `server/routes/employees.js` — GET perfil propio, ADMIN: CRUD completo
- [ ] `server/routes/clients.js` — CRUD (ADMIN+COMERCIAL escriben, VIEWER lee)
- [ ] `server/routes/projects.js` — CRUD proyectos, soft delete, clonar
- [ ] `server/middleware/audit.js` — Interceptor que registra en `project_audit_log`
- [ ] Vista: `#/employees` — Perfil de empleado con datos completos + foto
- [ ] Vista: `#/clients` — Panel CRM: lista, búsqueda, alta/edición de clientes
- [ ] Vista: `#/projects` — Lista de proyectos con estado, cliente, acciones
- [ ] Modal: Nuevo Proyecto (nombre, Odoo ref, cliente opcional)
- [ ] Modal: Asignar VIEWER a proyecto (ADMIN/COMERCIAL)
- [ ] Modal: Historial auditoría de proyecto

### Criterios de aceptación
- COMERCIAL ve solo sus proyectos; ADMIN ve todos
- Soft delete: proyecto desaparece del listado normal, ADMIN puede ver con filtro
- Clonar proyecto copia ítems + parámetros + cliente, no planos
- Auditoría registra CREATE, UPDATE, DELETE, CLONE con diff
- Cliente asignado visible en InfoBar del proyecto activo
- Contador de proyectos por cliente actualizado en CRM

---

## SPRINT 2 — Catálogo Administrable
**Duración:** 2 semanas | **Prioridad:** ALTA  
**Objetivo:** ADMIN gestiona el catálogo; comerciales y todos leen.

### Entregables
- [ ] `db/schema.sql` ampliado: catalog_categories, catalog_items
- [ ] `server/routes/catalog.js` — GET público, POST/PUT/DELETE solo ADMIN
- [ ] `db/seed.js` — 55 ítems + 4 categorías migradas del HTML v6.0
- [ ] Vista admin: `#/catalog` — CRUD categorías con drag para reordenar
- [ ] Vista admin: `#/catalog` — CRUD ítems con filtro por categoría, búsqueda, tipo
- [ ] Modal: Nueva categoría (nombre, orden, activo)
- [ ] Modal: Nuevo ítem (código, descripción, unidad, tipo, precio, categoría)
- [ ] Validación: código de ítem único por categoría
- [ ] Cache Redis del catálogo (TTL 24h, invalidar en escritura)
- [ ] Fallback a cache local si API falla (staleTime React Query style)

### Criterios de aceptación
- Solo ADMIN accede a las rutas de escritura del catálogo
- CRUD categorías: crear, editar nombre/orden, activar/desactivar
- CRUD ítems: todos los campos editables incluyendo precio
- Desactivar ítem: ya no aparece en búsqueda del catálogo, sigue en proyectos existentes
- Los 55 ítems del seed son idénticos a los del HTML v6.0

---

## SPRINT 3 — Módulo Presupuesto (Catálogo + Ítems en Proyecto)
**Duración:** 2 semanas | **Prioridad:** ALTA  
**Objetivo:** El comercial puede construir el presupuesto de un proyecto.

### Entregables
- [ ] `db/schema.sql` ampliado: project_items
- [ ] `server/routes/items.js` — CRUD ítems del proyecto
- [ ] Panel izquierdo: catálogo filtrable (búsqueda debounce 200ms, filtro por categoría)
- [ ] Panel central: tabla de ítems con edición inline (precio, cantidad)
- [ ] Footer: subtotal ACTIVOS | subtotal CONSUMIBLES | total lista
- [ ] Botón LIMPIAR con modal de confirmación
- [ ] Modal: Pieza personalizada (código, nombre, tipo, unidad, qty, precio)
- [ ] Sincronización InfoBar: total lista, contador ítems
- [ ] Persistencia en BD con debounce 300ms (fire-and-forget optimista)
- [ ] Animación fade-out al eliminar ítem
- [ ] Transición automática a estado `EN_SEGUIMIENTO` al agregar primer ítem

### Criterios de aceptación
- Filtrar categoría + buscar simultáneamente funciona
- Click en ítem agrega con qty y precio configurados
- Si ítem ya existe con mismo precio → suma qty (no duplica fila)
- Editar precio/cantidad → totales actualizan en tiempo real
- Cambios persisten en BD (recarga de página no los pierde)
- Pieza personalizada funciona igual que ítem del catálogo

---

## SPRINT 4 — Módulos Financieros M1-M4
**Duración:** 2 semanas | **Prioridad:** ALTA  
**Objetivo:** Motor financiero completo integrado con el presupuesto.

### Entregables
- [ ] `shared/finance-engine.js` — Motor puro migrado del HTML v6.0
- [ ] Tests del finance engine (Vitest/Jest, coverage ≥ 95%)
- [ ] Integración en frontend: acordeones M1, M2, M3, M4 con todos los parámetros
- [ ] **M1 Venta Directa**: margen/descuento, recálculo en tiempo real
- [ ] **M2 Corto Plazo**: todos los parámetros, KPIs ganancia+PE, timeline
- [ ] **M3 Largo Plazo**: sistema francés, tabla amortización, timeline F1-F2
- [ ] **M4 Estacionalidad**: tabla 5 años, Regla de Oro, alertas
- [ ] Activación selectiva: comercial activa 1 o N modalidades simultáneas
- [ ] Parámetros persistidos en `projects.finance_params` JSONB
- [ ] Recálculo automático al cambiar cualquier parámetro
- [ ] Vista VIEWER: solo totales por modalidad activada (sin márgenes ni ROA)

### Criterios de aceptación
- M1 ventaTotal es la base de M2, M3, M4
- Cambiar adjPct en M1 recalcula todo en cascada inmediatamente
- Regla de Oro validada con tolerancia ±$1
- VIEWER no puede ver ROA, márgenes, ni parámetros internos
- Finance engine produce resultados idénticos al HTML v6.0 (tests de regresión)
- Múltiples modalidades activas simultáneamente se muestran en paralelo

---

## SPRINT 5 — Planos Técnicos
**Duración:** 1.5 semanas | **Prioridad:** MEDIA  
**Objetivo:** Gestión de archivos con trazabilidad de versiones.

### Entregables
- [ ] `db/schema.sql` ampliado: project_plans
- [ ] `server/config/s3.js` — Cliente MinIO/S3
- [ ] `server/services/storage.service.js` — upload, signed URL, delete
- [ ] `server/routes/plans.js` — CRUD planos con versioning
- [ ] Multer config: max 25MB, validación MIME
- [ ] Panel planos: drag & drop, lista de archivos con versiones
- [ ] Preview imágenes con URL firmada (TTL 15min)
- [ ] Historial de versiones para ADMIN y COMERCIAL
- [ ] Vista VIEWER: solo plano `is_current=true` con versión mayor
- [ ] Badge contador de planos en la pestaña
- [ ] Notas de revisión al subir nueva versión

### Criterios de aceptación
- Upload arrastra o hace click, muestra progress bar
- Múltiples archivos en una sola operación
- Versión anterior NO se elimina, queda en historial
- VIEWER no ve versiones anteriores, solo el plano actual
- Eliminar plano: confirmación + borrado físico en S3 + BD
- Formatos aceptados: PDF, DWG, DXF, PNG, JPG, JPEG, SVG

---

## SPRINT 6 — Exportación PDF + Panel Gerencial
**Duración:** 2 semanas | **Prioridad:** ALTA  
**Objetivo:** Reportes profesionales y dashboard gerencial.

### Entregables
- [ ] `server/workers/pdf.worker.js` — BullMQ + Puppeteer
- [ ] `server/services/pdf.service.js` — Templates HTML para PDFs
- [ ] `server/routes/export.js` — POST /api/export/pdf (async job)
- [ ] Polling frontend: GET /api/export/status/:jobId cada 2s
- [ ] **PDF Gerencia**: portada + presupuesto + análisis financiero completo + panel gerencial
- [ ] **PDF Cliente**: portada + totales por modalidad + plano final (sin datos internos)
- [ ] Logo ZGROUP en header de PDFs
- [ ] **M5 Panel Gerencial**: comparativa CP vs LP, veredicto, horizonte configurable
- [ ] Vista admin: `#/dashboard` — KPIs globales, KPIs por comercial
- [ ] Vista admin: `#/dashboard` — Proyectos por estado, valor pipeline, ratio cierre
- [ ] Record por comercial: tabla con métricas individuales
- [ ] `db/schema.sql` ampliado: project_budget_snapshots

### Criterios de aceptación
- PDF Gerencia incluye Panel Gerencial con todos los parámetros
- PDF Cliente NO incluye ROA, márgenes ni parámetros internos
- PDFs generados correctamente con 0 ítems y con 55 ítems
- Notificación cuando el PDF está listo (polling + toast)
- Panel Gerencial: veredicto actualiza en tiempo real
- Dashboard admin: KPIs correctos por comercial

---

## SPRINT 7 — Pulimiento, Testing, Deploy
**Duración:** 2 semanas | **Prioridad:** MEDIA  
**Objetivo:** Sistema production-ready.

### Entregables
- [ ] Tests de integración de seguridad por rol (ADMIN/COMERCIAL/VIEWER)
- [ ] Tests E2E flujo completo: login → proyecto → presupuesto → PDF
- [ ] Docker Compose: Node, PostgreSQL, Redis, MinIO
- [ ] Variables de entorno documentadas en `.env.example`
- [ ] SSL/TLS configurado
- [ ] Rate limiting revisado y ajustado
- [ ] Seed de datos de demo para training de comerciales
- [ ] Manual de usuario (PDF) para COMERCIAL y ADMIN
- [ ] Backup policy PostgreSQL configurado
- [ ] Monitoring básico: logs de error, health endpoint
- [ ] Performance audit: queries lentas, índices PostgreSQL
- [ ] UX polish: estados de carga, mensajes de error, empty states

### Criterios de aceptación
- Todos los criterios de aceptación de sprints 0-6 verificados
- Tiempo de carga inicial < 2s en red estándar
- No hay datos de un usuario accesibles por otro usuario
- Finance engine tests pasan con 95%+ coverage
- Sistema funciona correctamente con Docker Compose
- Documentación de onboarding lista para el primer comercial

---

## RESUMEN DE SPRINTS

| Sprint | Tema | Semanas | Esfuerzo | Estado |
|--------|------|---------|---------|--------|
| 0 | Fundación + Auth + Roles | 2 | Alto | 🟡 En curso |
| 1 | Empleados + Clientes + Proyectos | 2 | Alto | ⏳ Pendiente |
| 2 | Catálogo Administrable | 2 | Medio | ⏳ Pendiente |
| 3 | Módulo Presupuesto | 2 | Alto | ⏳ Pendiente |
| 4 | Módulos Financieros M1-M4 | 2 | Alto | ⏳ Pendiente |
| 5 | Planos Técnicos | 1.5 | Medio | ⏳ Pendiente |
| 6 | PDF + Panel Gerencial | 2 | Alto | ⏳ Pendiente |
| 7 | Pulimiento + Deploy | 2 | Medio | ⏳ Pendiente |
| **Total** | | **15.5 semanas** | | |

---

## DEPENDENCIAS TÉCNICAS COMPLETAS

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.3",
    "jsonwebtoken": "^9.0.2",
    "bcrypt": "^5.1.1",
    "cookie-parser": "^1.4.6",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express-rate-limit": "^7.1.5",
    "multer": "^1.4.5-lts.1",
    "aws-sdk": "^2.1500.0",
    "bull": "^4.12.2",
    "puppeteer": "^21.5.2",
    "sharp": "^0.32.6",
    "express-validator": "^7.0.1",
    "morgan": "^1.10.0",
    "helmet": "^7.1.0",
    "compression": "^1.7.4"
  },
  "devDependencies": {
    "nodemon": "^3.0.2",
    "vitest": "^1.0.0",
    "supertest": "^6.3.3"
  }
}
```

---

## DIAGRAMA DE FLUJO DE DESARROLLO

```
Sprint 0 ──→ Sprint 1 ──→ Sprint 2
    │              │           │
    └──────────────┴───────────┴──→ Sprint 3 ──→ Sprint 4
                                        │              │
                                        └──────────────┴──→ Sprint 5 ──→ Sprint 6 ──→ Sprint 7
```

Los sprints 0-2 son **paralelos** (infraestructura, entidades, catálogo).  
Los sprints 3-4 dependen de 0-2.  
Los sprints 5-6 pueden ser parcialmente paralelos.  
Sprint 7 es siempre el último.

---

*Plan actualizable — revisar al inicio de cada sprint con el equipo.*

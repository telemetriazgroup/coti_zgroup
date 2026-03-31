## Módulo  — Venta Directa (M1 Financial)

### Comportamiento
- Dos modos: **Margen de Seguridad** (sube el precio) o **Descuento Comercial** (baja el precio)
- Input porcentaje con step 0.5
- Resultado = `base ± base × (pct / 100)`
- El `ventaTotal` resultante es la **base de todos los módulos siguientes**

### Fórmulas
```
Margen:    ventaTotal = base × (1 + adjPct/100)
Descuento: ventaTotal = base × (1 - adjPct/100)
```

### Casos de borde
- adjPct = 0 → ventaTotal = base (válido)
- adjPct = 100 con descuento → ventaTotal = 0 (mostrar warning visual)
- Cambiar de margen a descuento → recalcular todo inmediatamente

### Criterios de aceptación
- [ ] El modo activo (Margen/Descuento) se resalta visualmente
- [ ] Cambiar % recalcula en tiempo real todos los módulos financieros
- [ ] "TOTAL VENTA" en el header del módulo sincroniza con el resultado
- [ ] Label del ajuste cambia según el modo ("+Seguridad" vs "−Dto.")

---

## Módulo  — Corto Plazo (M2 Financial)

### Comportamiento
Capital propio ZGROUP. ZGROUP compra el equipo, lo alquila y recupera la inversión.

### Parámetros
| Campo | Default | Descripción |
|-------|---------|-------------|
| Plazo contrato | 6 meses | Duración del alquiler |
| Vida útil CP | 60 meses | Desgaste por montaje/desmontaje frecuente |
| Gtos. Operativos | 5% anual | Mantenimiento, admin |
| ROA anual | 35% | Retorno sobre activos (la ganancia ZGROUP) |
| Factor merma montaje | 2% | Daño por instalación, amortizado en el contrato |

### Fórmulas
```
Base = ventaTotal

Depreciación mensual = ventaTotal / vidaUtil_CP
Merma mensual        = ventaTotal × (merma% / 100) / plazoContrato
Gtos.Op mensual      = ventaTotal × (gtosOp% / 100) / 12
Consumibles mensual  = totalConsumibles / plazoContrato  (solo si hay consumibles)
ROA mensual          = ventaTotal × (ROA% / 100) / 12   ← GANANCIA ZGROUP

Renta al cliente     = Dep + Merma + Gtos.Op + Consumibles + ROA

Ganancia ZGROUP/mes  = ROA mensual
Punto de equilibrio  = ceil(ventaTotal / ROA_mensual)   [meses]
```

### Casos de borde
- Sin consumibles → fila de consumibles oculta
- Vida útil < plazo contrato → warning (depreciación > precio en el contrato)
- ROA = 0 → Ganancia = 0, PE = infinito (mostrar "—")

### Criterios de aceptación
- [ ] Todos los labels dinámicos sincronizan (vida útil, merma%, plazo)
- [ ] Con consumibles → fila visible con monto correcto
- [ ] KPIs: Ganancia mensual (verde) y Punto equilibrio (cyan) correctos
- [ ] Header del acordeón muestra la renta al cliente actual

---

## Módulo  — Largo Plazo (M3 Financial)

### Comportamiento
El banco financia el 100% del equipo. ZGROUP gestiona el leasing y gana el spread
entre la tasa que paga al banco y la que cobra al cliente.

### Parámetros
| Campo | Default | Descripción |
|-------|---------|-------------|
| Vida útil LP | 120 meses | Mayor que CP (equipo estático) |
| Plazo préstamo banco | 24 meses | N del sistema francés |
| Plazo contrato cliente | 36 meses | Debe ser ≥ plazo banco |
| TEA banco | 7% | Costo financiero |
| Tasa cotización cliente | 15% | Lo que paga el cliente (debe > TEA banco) |
| Gtos. operativos | 5% anual | Mantenimiento admin |
| Gastos formalización | $350 | Costos notariales, SUNARP, etc. |
| Renta post-préstamo | 80% | % de la renta F1 que paga el cliente en F2 |
| Fondo de reposición | 5% anual | Se activa si contrato > 80% vida útil |

### Fórmulas — Sistema Francés
```
TotalFinanciado = ventaTotal + gastos_formalizacion

TEM_banco   = (1 + TEA_banco/100)^(1/12) - 1
TEM_cliente = (1 + TEA_cliente/100)^(1/12) - 1

Cuota banco   = TotalFin × TEM_banco   / (1 - (1+TEM_banco)^-N_banco)
Cuota cliente = TotalFin × TEM_cliente / (1 - (1+TEM_cliente)^-N_banco)

Gtos.Op mensual = ventaTotal × (gtosOp% / 100) / 12

── FASE 1 (meses 1 a N_banco) ──
Spread         = Cuota_cliente - Cuota_banco  ← ganancia ZGROUP F1
Renta F1       = Cuota_cliente + Gtos.Op       ← lo que paga el cliente
Ganancia F1/mes = Spread
Total F1        = Ganancia_F1 × N_banco

── FASE 2 (meses N_banco+1 a N_contrato) ──
N_F2            = N_contrato - N_banco
Renta F2        = Renta_F1 × (postPct/100)     ← fidelización, más barata
Ganancia F2/mes = Renta_F2 - Gtos.Op - Fondo_rep_mensual
Total F2        = Ganancia_F2 × N_F2

── TOTALES ──
Total_ciclo = Total_F1 + Total_F2
PE          = ceil(gastos_form / Ganancia_F1)  [meses para recuperar form.]

── FONDO DE REPOSICIÓN ──
Activar si: N_contrato > lpVida × 0.80
Fondo mensual = ventaTotal × (fondoRep% / 100) / 12
```

### Timeline Visual
- Barra horizontal con 2 fases: Fase1 (roja, proporcional) + Fase2 (verde)
- Marcador amarillo en el punto donde el banco queda liquidado
- Labels dinámicos con meses de cada fase

### Tabla de Amortización
- Expandible (lazy render)
- N filas × 5 columnas: N° | Saldo Inicial | Interés | Amortización | Cuota
- Virtualizar si N > 60 (usar @tanstack/virtual)

### Casos de borde
- N_contrato = N_banco → Fase 2 = 0 meses (solo mostrar Fase 1)
- TEA banco = 0 → cuota = TotalFin / N (sin interés)
- Tasa cliente < Tasa banco → Spread negativo → ERROR (mostrar alerta roja)
- N_contrato < N_banco → forzar N_contrato = N_banco (validar en UI)

### Criterios de aceptación
- [ ] Timeline se actualiza en tiempo real con los inputs
- [ ] Alerta de fondo de reposición aparece/desaparece correctamente
- [ ] Tabla de amortización muestra cuotas correctas (verificar con calculadora financiera)
- [ ] KPIs: Utilidad F1, Utilidad F2, Total Ciclo correctos
- [ ] Header del acordeón muestra renta F1 actual

---

## Módulo  — Estacionalidad (M4 Financial)

### Comportamiento
Para clientes agroindustriales que usan el equipo solo parte del año.
El contrato es anual pero con tarifa reducida en meses sin producción.

### Parámetros
| Campo | Default | Descripción |
|-------|---------|-------------|
| Meses operativos | 8 | Meses a tarifa full (campaña) |
| Meses standby | 4 | Meses a tarifa reducida (fuera de campaña) |
| Seguro (% anual) | 1% | Seguro del activo (cubre los 12 meses) |
| % Ajuste standby | 35% | % de la renta full que paga en standby |

### Fórmulas
```
Renta Full = Renta F1 del módulo LP (la referencia siempre es LP)
Renta Standby = Renta Full × (sbPct / 100)

Costo mínimo standby (piso) = Cuota banco + Seguro mensual + Gestión 5%
⚠️ Alerta si Renta Standby < Costo mínimo

── INGRESOS ANUALES ──
Ingreso full year     = Renta Full × meses_operativos
Ingreso standby year  = Renta Standby × meses_standby
Ingreso total año     = Ingreso full + Ingreso standby

── TABLA 5 AÑOS FIJOS ──
Para cada año (1-5):
  Meses en Fase 1 vs Fase 2 = según N_banco y N_contrato
  Ingreso bruto = f(meses F1/F2, seasonalRatio)
  Pago banco    = Cuota_banco × meses_en_F1
  Gtos.Op       = Gtos.Op mensual × meses_activos
  Utilidad neta = Ingreso - Pago banco - Gtos.Op
  Acumulado     = sum(util_neta hasta este año)

seasonalRatio = (estOp + estSb × sbPct/100) / 12

REGLA DE ORO: sum(UtilNeta 5 años) = Total_Ciclo_LP × seasonalRatio
```

### Alertas
1. **Standby < costo mínimo**: Alerta roja con el % mínimo requerido
2. **Fila de transición F1→F2**: Banner cyan cuando un año tiene ambas fases
3. **Primer año F2 completo**: Banner verde "Pago al banco = $0.00"

### Criterios de aceptación
- [ ] Alerta standby < costo mínimo con porcentaje correcto sugerido
- [ ] Tabla 5 años genera exactamente 5 años (filas fijas, no variable)
- [ ] Fila de totals (tfoot) suma correctamente
- [ ] Banners de transición y F2 aparecen en el año correcto
- [ ] Regla de Oro: suma de Utilidad Neta 5 años ≈ Total Ciclo LP × seasonalRatio (tolerancia ±$1)
- [ ] Header del acordeón muestra ingreso anual estimado

---

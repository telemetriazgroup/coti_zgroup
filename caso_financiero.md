# Caso financiero — diferencias entre el motor actual y la lógica de negocio

Documento de decisión. No cambia código. Compara `shared/finance-engine.js` (M1 venta, M2 corto plazo, M3 largo plazo) con el caso de `LOGICA_FINANCIERA.md` (líneas 1–154), corrido con los mismos insumos.

Caso de control:

| | Lista | Con margen 10 % | Sin ajuste |
|---|---:|---:|---:|
| Activos (7) | 45 000 | 49 500 | 0 |
| Consumibles (3) | 10 000 | 5 000 × 1,10 = 5 500 | 5 000 |
| Total | 55 000 | Venta directa **60 000** | |

Corto plazo del caso: contrato 12 meses, vida útil 60, GOP 5 % anual, ROA 30 % anual, merma 2 %.

Largo plazo del caso: vida 120, préstamo 24, contrato 36, TEA banco 7 %, margen Cost-Plus 30 %, GOP 5 %, formalización 350, renta post-préstamo 80 % de F1, fondo reposición 5 %.

El motor se ejecutó con esas bases separadas (ajuste solo sobre la parte marcada) y esos parámetros.

---

## 1. Lo que ya calcula igual

### Venta directa (M1)

El margen entra solo en las líneas con ajuste. El caso da venta de activos 49 500, consumibles 10 500 y total 60 000. El motor devuelve esos tres números.

### Corto plazo (M2), incluida la dilución de consumibles

La renta mensual ya es la suma de cinco piezas, y los consumibles ya se reparten en el **plazo del contrato**:

| Pieza | Fórmula actual | Caso | Motor |
|---|---|---:|---:|
| Depreciación | venta activos / vida útil | 825,00 | 825,00 |
| Merma | (venta activos × merma %) / plazo contrato | 82,50 | 82,50 |
| GOP | (venta total × GOP % anual) / 12 | 250,00 | 250,00 |
| Consumibles | venta consumibles / plazo contrato | 875,00 | 875,00 |
| ROA (ganancia) | (venta total × ROA % anual) / 12 | 1 500,00 | 1 500,00 |
| Renta al cliente | suma | 3 532,50 | 3 532,50 |
| Depreciación acumulada | depreciación × plazo | 9 900,00 | 9 900,00 |
| Residual de activos | venta activos − dep. acumulada | 39 600,00 | 39 600,00 |
| Ganancia del contrato | ROA × plazo | 18 000,00 | 18 000,00 |

El bloque final del documento (depreciación 213,86, consumibles ÷ 6 meses, punto de equilibrio 35 m) es el mismo motor con los valores por defecto de pantalla: plazo 6, ROA 35 %, no una segunda fórmula.

### Largo plazo: la forma de la fórmula, no los importes

Con la base del caso en **lista** (55 000 + formalización 350 = 55 350) el sistema francés a TEA 7 % compuesta da cuota **2 472,77**. El motor usa la misma cuota francesa y la misma tasa mensual compuesta, `(1 + TEA) ^ (1/12) − 1`, no TEA/12.

El resto del caso también sigue la fórmula que ya está escrita:

- GOP = base × 5 % / 12.
- Costo base = cuota banco + GOP.
- Utilidad F1 = costo base × 30 %. Renta F1 = costo base × 1,30.
- Renta F2 = renta F1 × 80 %.
- Utilidad F2 = renta F2 − GOP. El fondo de reposición no entra: el contrato (36) no supera el 80 % de la vida útil (96).
- Punto de equilibrio de la formalización = meses de utilidad F1 para cubrir 350 → 1 mes.
- Consumibles del detalle F1 = base consumibles / **meses de préstamo** (24), no / 36.
- Depreciación del detalle = base activos / vida útil 120. Residual F1 y residual final salen de esa depreciación × 24 y × 36.
- Utilidad del ciclo = utilidad F1 × 24 + utilidad F2 × 12. El caso da 50 424,12. No suma el residual del activo a esa utilidad.

---

## 2. Diferencia numérica del largo plazo: la base, no el método

El corto plazo del caso está sobre la **venta con margen** (60 000 / 49 500 / 10 500). El largo plazo del caso está sobre la **lista sin margen** (55 000 / 45 000 / 10 000) más la formalización.

| | Caso LP (lista) | Motor (venta + margen) |
|---|---:|---:|
| Capital financiado | 55 350 | 60 350 |
| Cuota banco | 2 472,77 | 2 696,15 |
| GOP / mes | 229,17 | 250,00 |
| Costo base | 2 701,94 | 2 946,15 |
| Utilidad F1 / mes | 810,58 | 883,84 |
| Renta F1 | 3 512,52 | 3 829,99 |
| Renta F2 | 2 810,01 | 3 063,99 |
| Utilidad F2 / mes | 2 580,85 | 2 813,99 |
| Utilidad del ciclo | 50 424,12 | 54 980,15 |
| Consumibles F1 / mes | 416,67 (10 000 / 24) | 437,50 (10 500 / 24) |
| Depreciación / mes | 375,00 (45 000 / 120) | 412,50 (49 500 / 120) |
| Residual fin F1 | 36 000,00 | 39 600,00 |
| Residual fin contrato | 31 500,00 | 34 650,00 |

Dentro de cada columna la fórmula es la misma. La brecha sale de aplicar el 10 % en corto plazo y no aplicarlo en el ejemplo de largo plazo.

En el cotizador el precio de catálogo ya es precio de venta, y el margen de M1 es otro ajuste comercial encima. El capital que se compara entre corto y largo plazo tiene que ser uno solo. Hoy el motor usa en los dos la venta ya ajustada. Eso hace comparable la renta de 3 532,50 con la de largo plazo. Si el largo plazo pasara a lista, el panel gerencial compararía dos inversiones distintas y el veredicto «LP más barato que CP» dejaría de ser honesto.

Recomendación: no cambiar el largo plazo a lista para “calzar” 2 472,77. Confirmar con el caso de negocio si aquellos números se armaron antes de cargar el margen. Si el banco financiara solo el costo de compra, haría falta una columna de costo que el presupuesto no tiene: los importes del catálogo son precios de venta.

---

## 3. Dilución de consumibles: ya está, y no es el mismo plazo en los dos módulos

| Módulo | Qué pide la prosa | Qué hacen los números del caso | Qué hace el motor |
|---|---|---|---|
| Corto plazo | Repartir en el plazo del contrato | 10 500 / 12 = 875 | Igual |
| Largo plazo | La prosa dice «plazo del contrato» | 10 000 / **24** (préstamo), no / 36 | Igual: consumibles / meses de préstamo |

A los 24 meses el motor ya repartió el 100 % de los consumibles. En fase 2 no queda un saldo de consumibles por cobrar (`consumiblesPendientesPostF1 = 0`). La utilidad de fase 2 no vuelve a sumar esa porción: es renta F2 menos GOP (y fondo, si se activara).

No conviene pasar el largo plazo a dividir entre 36 solo por la frase «plazo del contrato». El ejemplo numérico y el código coinciden en 24, y 10 000 / 36 sería 277,78, que no es el 416,67 escrito. Lo que sí falta en pantalla es decirlo en claro: en corto plazo el divisor es el contrato; en largo plazo el divisor es la fase con banco. Si más adelante el contrato largo se alarga y el préstamo no, los consumibles siguen cayendo todos en la fase 1.

---

## 4. Lo que el caso pide y el motor no tiene

El motor ya muestra residual (39 600) y ganancia del contrato (18 000) por separado. No arma la lectura que sigue, ni la curva para llegar a cero.

### 4.1 Hueco de recuperación al cierre del contrato corto

Lectura del caso: en 12 meses se ganó 18 000 (solo el ROA) y el activo aún vale en libros 39 600. Falta 39 600 − 18 000 = **21 600** para que la ganancia cubra el valor que todavía no se depreció.

El punto de equilibrio que hoy muestra el motor responde otra pregunta: `ceil(venta total / ROA mensual)` = ceil(60 000 / 1 500) = **40 meses**. Son los meses de ganancia ROA necesarios para igualar toda la venta, desde el mes 1, sin mirar el residual. No es el hueco de 21 600 y no debe reemplazarse: las dos lecturas conviven.

- 40 meses: ¿cuánta ganancia ROA hace falta para igualar el capital de venta?
- 21 600: al terminar este contrato, ¿cuánto valor de activo sigue en libros por encima de la ganancia ya anotada?

La renta de 3 532,50 no es “lo que falta”. Dentro de esa renta la depreciación, la merma, el GOP y los consumibles son recuperación de costo o gasto. Solo el ROA es ganancia. Por eso el caso resta la ganancia del residual y no resta la renta entera.

### 4.2 Costo de oportunidad, opcional

Un 5 % anual en una cuenta estable no es 5 % / 12. La tasa mensual equivalente es `(1,05) ^ (1/12) − 1` = **0,4074 %**. Es la misma convención de tasa compuesta que el largo plazo ya usa para la TEA del banco.

El caso pide que sea opcional y que deje de tratar el hueco como una resta plana de mes contra mes. El saldo no recuperado arrastra ese rendimiento: cada mes el activo que sigue inmovilizado “cobra” 0,4074 % además de lo que la renta va cubriendo.

Hoy la curva de `m4.recoveryCurve` acumula la utilidad contable (ROA en corto plazo, o el margen de fase 1 y fase 2 en largo plazo), a lo sumo 60 meses, sin tasa y sin saldo de capital. Sirve para el panel de utilidad. No sirve para esta recuperación.

### 4.3 Dos caminos después de diluir los consumibles

Mientras dura el contrato, los 875 de consumibles son costo recuperado, no ganancia. Cuando ese costo ya se cobró:

- Si la renta se mantiene, esos 875 pasan a ganancia. La ganancia mensual deja de ser 1 500 y pasa a 1 500 + 875 = 2 375, y el hueco se cierra antes.
- Si se le baja la renta al cliente, el descuento sano es como máximo esa porción (875 en el caso, o el monto diluido que corresponda). Se puede dejar un monto libre de descuento. Si el descuento es mayor que los consumibles diluidos, se está comiendo el ROA y hay que decirlo antes de ofrecer la tarifa.

El motor no tiene ese escenario ni un campo de descuento. El largo plazo sí tiene un recorte, pero es otro: la renta de fase 2 es el 80 % de toda la renta de fase 1, no “quitar solo los consumibles”.

### 4.4 Largo plazo: caja y activo, por separado

La prosa de fase 1 es correcta como lectura de negocio y ya está desglosada en el motor: el banco queda cubierto por la cuota, ZGROUP se queda con el margen de los 24 meses y con el activo (residual). En fase 2 la cuota ya no existe; la renta menos el GOP es ganancia, y se puede mantener la tarifa o bajarla con el porcentaje post-préstamo.

Lo que no hay que hacer es sumar el residual a los 50 424 (o a los 54 980 del motor) y llamar a eso “utilidad del proyecto”. El residual es valor en libros del equipo que sigue siendo de ZGROUP, no caja cobrada. En gerencia van en dos líneas. En el PDF al cliente va la renta, no el residual ni el “estamos en rojo”.

---

## 5. Recomendación para implementar después

Orden sugerido, cuando se decida tocar el motor. Hasta entonces no hay cambio de fórmula.

1. **Dejar M1, la renta de corto plazo y el Cost-Plus como están.** El caso de 12 meses ya cuadra, consumibles incluidos. El largo plazo solo debe seguir usando la venta ajustada, la misma base que el corto plazo, salvo una decisión explícita de financiar otra cifra.
2. **Nombrar el divisor en la interfaz.** Corto plazo: consumibles ÷ meses de contrato. Largo plazo: consumibles ÷ meses de préstamo (fase 1). Así la frase “plazo del contrato” no se lee como si los dos módulos dividieran entre los mismos meses.
3. **Añadir un bloque de recuperación solo de gerencia**, sin cambiar la renta que ve el cliente.
   - Hueco al cierre del contrato corto: residual de activos − ganancia ROA del contrato.
   - Mantener el punto de equilibrio actual (venta / ROA mensual). Es otra pregunta.
   - Costo de oportunidad apagado por defecto. Si se enciende, tasa anual y su equivalente mensual compuesta. El saldo no recuperado crece a esa tasa cada mes; la renta (o la ganancia, según el modo que se fije al implementar) lo va bajando. Mostrar el mes en que el saldo llega a cero si se mantiene la tarifa.
4. **Escenario de tarifa tras los consumibles**, también de gerencia.
   - Tarifa igual: la porción de consumibles se suma a la ganancia desde el mes siguiente al contrato, y se recalcula el mes de recuperación.
   - Descuento: tope informado = consumibles diluidos por mes. Monto editable. Si el descuento lo supera, aviso de que la ganancia ROA queda por debajo de la proyectada. No aplicar ese descuento solo al PDF cliente hasta que alguien lo confirme en el presupuesto.
5. **Largo plazo.** No mezclar residual con utilidad de caja. El porcentaje post-préstamo sigue siendo el modo de “bajar el alquiler” en fase 2. No reutilizarlo como descuento de consumibles: en fase 2 esos consumibles ya se diluyeron en la fase 1.
6. **PDF.** Cliente: renta y, si el comercial tiene el módulo habilitado, el monto final. Gerencia: componentes, residual, hueco y, si está activo, costo de oportunidad y escenario de descuento. El comercial no ve la tasa de oportunidad ni el desglose, igual que hoy no ve el cálculo detrás de la renta.

Fuera de este caso quedan, a propósito, estacionalidad (M4) y el panel que compara rentas (M5). Ninguno de los dos cambia la renta mensual. M5 seguirá siendo válido solo si corto y largo plazo comparten la misma venta.

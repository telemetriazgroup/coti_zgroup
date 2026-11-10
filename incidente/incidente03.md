# Incidente 03 — Consumibles de un producto final contados en cero

**Fecha:** 2026-11-10  
**Reportado por:** operación / cotización  
**Rol afectado:** quien arma el presupuesto y revisa corto plazo

## Observación

En un presupuesto con el producto final **PF-0001 STORE 2XL — ZSTORE 2XL** (cabecera **$31,390.00**), el pie del presupuesto mostraba:

- Activos: **$31,390.00**
- Consumibles: **$0.00**
- Total lista: **$31,390.00**

Dentro del conjunto sí hay dos consumibles:

| Código | Descripción | Subtotal de componente |
| --- | --- | --- |
| AC-0024 | CORTINA VINIL TRANSPARENTE 2300MM X 2500MM | $300.00 |
| AC-0033 | UNION PLEGABLE PARA XL — POR LINEA | $1,500.00 |

El resto del conjunto (transformador, máquina reefer, dos cajas isotérmicas) es activo. En corto plazo no aparecía la fila **Consumibles diluidos / mes**, porque esa fila solo se muestra si la base de consumibles es mayor que cero. La depreciación, la merma y el residual tomaban los $31,390 enteros como activo.

## Causa

El total del presupuesto (y el mismo cálculo del PDF) **omite las filas componente** del kit para no sumar dos veces el conjunto. El importe que sí entra es el de la **cabecera**.

La cabecera de un producto final se guarda con el tipo del kit, que es **ACTIVO**. Los componentes conservan su tipo de catálogo (`CONSUMIBLE` en la cortina y en la unión plegable), pero al saltarlos ese tipo no llega a la base. Todo el precio cobrado del kit cae en activos.

El corto plazo ya diluye `ventaConsumibles / plazo del contrato`. Con base 0, la cuota diluida sale 0. No era un error de la fórmula del motor: la base que le llegaba estaba mal clasificada.

Los componentes se guardan además con `apply_adjustment = false`. El checkbox de ajuste vive en la cabecera. Por eso el reparto tiene que usar la bandera de la cabecera, no la de cada componente.

## Qué se hizo

1. Una sola función (`server/lib/budgetTotals.js`) arma activos y consumibles para la pantalla y para el PDF.
2. Si la fila es cabecera de kit y tiene componentes, el **subtotal cobrado** (ya con el descuento del conjunto y la cantidad del kit) se reparte en la proporción del subtotal de componentes de cada tipo.
3. Los componentes no se vuelven a sumar. El total lista no cambia: sigue siendo el precio del conjunto.
4. La bandera de ajuste de la cabecera aplica a las dos porciones. El margen de M1, si está activo, cubre también la parte consumible del kit.
5. Una línea suelta (que no es componente) sigue yendo entera a su tipo.
6. El motor financiero no se tocó. Al recibir consumibles > 0, corto plazo muestra y suma `venta de esa porción / plazo del contrato`.

Con los subtotales de este caso (componentes $33,390, de los cuales $1,800 son consumibles, cabecera cobrada $31,390), la parte consumible del precio cobrado es **$1,692.18** y la parte activa **$29,697.82**. La diferencia frente a los $1,800 de lista de componentes es el descuento del kit, repartido en la misma proporción. A plazo 60 meses y sin margen, el consumible diluido es **$28.20 / mes**. Depreciación, merma y residual pasan a calcularse solo sobre la parte activa, no sobre la cortina ni la unión.

## Documentos

El PDF de gerencia armaba ACTIVOS con las filas que no son componente. La cabecera del kit es tipo ACTIVO, así que el conjunto entero caía en activos y la cortina y la unión no aparecían como consumibles. El PDF de cliente repetía esa cabecera con tipo ACTIVO.

Ahora los dos documentos usan el mismo reparto que el presupuesto: la cabecera figura como conjunto y cada componente entra en activos o consumibles por su tipo, con la parte proporcional del precio cobrado.

## Qué no cambia

- El total lista del presupuesto.
- La fórmula de dilución del corto plazo (`ventaConsumibles / plazoContrato`).
- El largo plazo, que ya diluye consumibles entre los meses del préstamo cuando la base es mayor que cero.

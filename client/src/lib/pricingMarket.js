/** Precio de catálogo según el mercado del proyecto (no el del usuario que mira). */
export function catalogUnitPriceForMarket(item, market) {
  const national = Number(item?.unitPrice ?? 0);
  if (market === 'INTERNACIONAL' && item?.hasDualPrice === true && item.unitPriceIntl != null) {
    return Number(item.unitPriceIntl);
  }
  return national;
}

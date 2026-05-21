import { api } from './api';

/** Sugerencia de código correlativo por categoría (prefijo SF → SF-0011). */
export async function fetchCategoryNextCodigo(categoryId) {
  if (!categoryId) return null;
  return api.get(`/api/catalog/categories/${categoryId}/next-codigo`);
}

export async function regularizeCategoryCodigos(categoryId) {
  return api.post(`/api/catalog/categories/${categoryId}/regularize-codigos`);
}

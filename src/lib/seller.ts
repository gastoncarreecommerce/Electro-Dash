/**
 * Este dashboard es un fork de https://github.com/gastoncarreecommerce/DashboardMarketplace
 * recortado a un único seller: en vez de iterar sobre el listado maestro de
 * ~110 sellers del Marketplace, todas las consultas a la API de VTEX se
 * filtran únicamente por este seller.
 *
 * VTEX_SELLER_ID es opcional: si se conoce el sellerId real, completarlo acá
 * mejora el matching (algunas respuestas de OMS solo traen sellerId, no
 * sellerName). Sin él, el filtrado funciona igual por sellerName exacto.
 */
export const SELLER = {
  id: process.env.VTEX_SELLER_ID || "",
  name: "Hogar&Electro",
} as const;

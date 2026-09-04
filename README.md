# Hogar&Electro VTEX Dashboard

Fork de [DashboardMarketplace](https://github.com/gastoncarreecommerce/DashboardMarketplace)
recortado a un único seller: en vez de iterar sobre el listado maestro de
~110 sellers del Marketplace, todas las consultas a la API de VTEX se
filtran únicamente por **Hogar&Electro** (ver `src/lib/seller.ts`).

No usa base de datos ni webhooks: cada request consulta la API de VTEX
(`/api/oms/pvt/orders`) en vivo, filtrando por `f_sellerNames=Hogar&Electro`.

## Run

```bash
npm install
npm run dev
```
Abrir: `http://localhost:3000/dashboard`

## Variables de entorno

```
VTEX_ACCOUNT=<cuenta-vtex>
VTEX_APP_KEY=<app-key>
VTEX_APP_TOKEN=<app-token>
# Opcional, si se conoce el sellerId real (mejora el matching):
VTEX_SELLER_ID=<seller-id>
# Opcional, storefront para linkear productos:
VTEX_STOREFRONT_URL=https://www.tu-tienda.com.ar
# Opcional, desde qué fecha trae datos el modo "Histórico" del dashboard:
VTEX_HISTORY_FROM=2023-01-01
# Opcional, desde qué año/mes arranca /historico si no se pasa ?from=:
VTEX_HISTORY_FROM_YEAR=2024
VTEX_HISTORY_FROM_MONTH=1

# Login
DASHBOARD_PASSWORD=<contraseña-compartida>
```

## Páginas

- `/dashboard` — KPIs en vivo (hoy, ayer, 7d, 30d, histórico, rango custom),
  evolución de GMV/pedidos, embudo de estados, medios de pago, heatmap horario,
  top productos y atribución de marketing — todo filtrado a Hogar&Electro.
- `/historico` — GMV/pedidos/cancelaciones mes a mes desde el inicio del
  histórico configurado, consultado en vivo contra VTEX (con caché en memoria
  para meses ya cerrados, para no repetir consultas).

## Deploy

```bash
vercel
```

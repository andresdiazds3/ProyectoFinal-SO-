'use strict';

// -----------------------------------------------------------------------------
// 1. IMPORTS
// -----------------------------------------------------------------------------
const os = require('os');               // hostname del contenedor
const express = require('express');     // servidor web
const client = require('prom-client');  // librería oficial de métricas Prometheus

// -----------------------------------------------------------------------------
// 2. CONFIGURACIÓN (variables de entorno que define el docker-compose.yml)
// -----------------------------------------------------------------------------
// SERVER_NAME: nombre de la instancia, p. ej. "server 1". Es el valor que
//              aparece en las respuestas y en la etiqueta "backend" de las
//              métricas (así las leyendas de Grafana dicen "server 1").
// PORT:        puerto interno donde escucha la API.
const SERVER_NAME = process.env.SERVER_NAME || 'sin-nombre';
const PORT = Number(process.env.PORT) || 3000;

// -----------------------------------------------------------------------------
// 3. MÉTRICAS DE PROMETHEUS
// -----------------------------------------------------------------------------
const register = new client.Registry();

// Etiqueta "backend" en TODAS las métricas (igual que default_labels del lab).
register.setDefaultLabels({ backend: SERVER_NAME });

// Métricas del proceso (memoria, CPU, event loop...): líneas "process_*".
client.collectDefaultMetrics({ register });

// CONTADOR flask_http_request_total{backend, method, status}
// Solo sube. Con rate() se convierte en "peticiones por segundo".
const requestTotal = new client.Counter({
  name: 'flask_http_request_total',
  help: 'Total de peticiones HTTP',
  labelNames: ['method', 'status'],
  registers: [register],
});

// HISTOGRAMA flask_http_request_duration_seconds{backend, endpoint, method, status}
// Cuenta cuántas peticiones tardaron menos de 5 ms, 10 ms, 25 ms...
// Con histogram_quantile() se calcula la latencia p95.
// Los buckets son los mismos que usa prometheus-flask-exporter por defecto.
const requestDuration = new client.Histogram({
  name: 'flask_http_request_duration_seconds',
  help: 'Duración de las peticiones HTTP en segundos',
  labelNames: ['endpoint', 'method', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10],
  registers: [register],
});

// MEDIDOR app_info{backend, server} = 1 (igual que metrics.info del lab).
const appInfo = new client.Gauge({
  name: 'app_info',
  help: 'Información del backend',
  labelNames: ['server'],
  registers: [register],
});
appInfo.set({ server: SERVER_NAME }, 1);

// -----------------------------------------------------------------------------
// 4. SERVIDOR EXPRESS
// -----------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');

// Nombre de "endpoint" de cada ruta, igual que el nombre de la función en Flask
// (así la etiqueta endpoint="index" coincide con la del laboratorio). Se agrupa
// por ruta y no por URL real, para no crear una serie por cada URL inventada.
const NOMBRE_ENDPOINT = {
  '/': 'index',
  '/headers': 'headers',
  '/slow': 'slow',
};

// Rutas que NO se cuentan (igual que excluded_paths del lab):
// /health la consulta Docker cada 10 s y /metrics la consulta Prometheus.
const RUTAS_EXCLUIDAS = new Set(['/health', '/metrics']);

// MIDDLEWARE 1: pone la cabecera X-Backend en TODAS las respuestas.
// Con "curl -I" se ve qué backend respondió.
app.use((req, res, next) => {
  res.set('X-Backend', SERVER_NAME);
  next();
});

// MIDDLEWARE 2: mide cada petición. Arranca un cronómetro y, cuando la
// respuesta termina ("finish"), registra el contador y la latencia.
app.use((req, res, next) => {
  if (RUTAS_EXCLUIDAS.has(req.path)) return next();

  const detenerCronometro = requestDuration.startTimer();

  res.on('finish', () => {
    const ruta = req.route ? req.route.path : null;
    const status = String(res.statusCode);

    requestTotal.inc({ method: req.method, status });
    detenerCronometro({
      endpoint: NOMBRE_ENDPOINT[ruta] || 'no_encontrada',
      method: req.method,
      status,
    });
  });

  next();
});

// -----------------------------------------------------------------------------
// 5. RUTAS
// -----------------------------------------------------------------------------

// GET / -> dice quién responde. Sirve para comprobar el balanceo: al pedirlo
// varias veces debe alternar entre "server 1", "server 2" y "server 3".
app.get('/', (req, res) => {
  res.type('html').send(
    `<h1>Hello from ${SERVER_NAME}</h1>\n` +
    `<p>Contenedor: ${os.hostname()}</p>\n`
  );
});

// GET /health -> lo usa el healthcheck de Docker.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: SERVER_NAME });
});

// GET /headers -> muestra qué cabeceras recibe realmente el backend. Útil para
// demostrar que Nginx pasa X-Forwarded-For y X-Real-IP.
app.get('/headers', (req, res) => {
  res.json({
    server: SERVER_NAME,
    ip_que_ve_el_backend: req.socket.remoteAddress,
    cabeceras: req.headers,
  });
});

// GET /slow?ms=500 -> simula trabajo pesado: tarda 500 ms en responder.
// Por defecto 1000 ms; máximo 30000 ms. Sirve para controlar la latencia en
// las pruebas de carga.
app.get('/slow', (req, res) => {
  const pedido = parseInt(req.query.ms, 10);
  const ms = Math.min(Number.isNaN(pedido) ? 1000 : Math.max(pedido, 0), 30000);
  setTimeout(() => {
    res.json({ server: SERVER_NAME, 'esperó_ms': ms });
  }, ms);
});

// GET /metrics -> aquí lee Prometheus todas las métricas (formato texto).
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// -----------------------------------------------------------------------------
// 6. ARRANCAR
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`${SERVER_NAME} escuchando en el puerto ${PORT}`);
});

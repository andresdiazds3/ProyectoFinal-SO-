// =============================================================================
// Proyecto final – Administración de Sistemas Operativos (UAO)
// Archivo     : loadtest/k6-load.js
// Fase        : 6 – Pruebas de carga
// Responsable : Persona 3
// Propósito   : Carga progresiva contra Nginx. Cuenta cuántas respuestas
//               atendió cada backend para demostrar el balanceo.
// Uso         : k6 run loadtest/k6-load.js
//               k6 run -e BASE_URL=http://localhost:8080 loadtest/k6-load.js
// =============================================================================
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

// Dirección de Nginx vista desde la máquina donde corre k6.
const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

// Un contador por backend: al final k6 muestra cuántas respuestas dio cada uno.
const respuestas = {
  '1': new Counter('respuestas_server1'),
  '2': new Counter('respuestas_server2'),
  '3': new Counter('respuestas_server3'),
};

export const options = {
  // VUs = usuarios virtuales simultáneos. Sube, se sostiene y baja.
  stages: [
    { duration: '30s', target: 20 },   // calentamiento
    { duration: '1m',  target: 50 },   // carga sostenida
    { duration: '30s', target: 100 },  // pico
    { duration: '30s', target: 0 },    // enfriamiento
  ],
  // Criterios de éxito: si no se cumplen, k6 marca la prueba como fallida.
  thresholds: {
    http_req_failed: ['rate<0.01'],      // menos de 1 % de errores
    http_req_duration: ['p(95)<800'],    // el 95 % responde en menos de 800 ms
  },
};

export default function () {
  // 1) Petición rápida: sirve para ver la rotación entre backends.
  const r = http.get(`${BASE_URL}/`);
  check(r, { 'GET / responde 200': (x) => x.status === 200 });

  // El cuerpo trae "Hello from server N": se extrae N y se cuenta.
  const m = r.body && r.body.match(/server (\d)/);
  if (m && respuestas[m[1]]) respuestas[m[1]].add(1);

  // 2) Petición con latencia controlada (200 ms) para tener p95 interesante.
  const s = http.get(`${BASE_URL}/slow?ms=200`);
  check(s, { 'GET /slow responde 200': (x) => x.status === 200 });

  sleep(0.1);
}

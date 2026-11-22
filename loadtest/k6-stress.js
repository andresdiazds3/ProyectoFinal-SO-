// =============================================================================
// Proyecto final – Administración de Sistemas Operativos (UAO)
// Archivo     : loadtest/k6-stress.js
// Fase        : 6 – Pruebas de carga
// Responsable : Persona 3
// Propósito   : Prueba de estrés: sube la carga hasta saturar los backends
//               para ver dónde se degrada la latencia.
// Uso         : k6 run loadtest/k6-stress.js
// =============================================================================
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '30s', target: 150 },
    { duration: '30s', target: 300 },   // zona de saturación
    { duration: '30s', target: 0 },
  ],
  // Aquí NO se espera que todo pase: queremos ver cuándo empieza a fallar.
  thresholds: {
    http_req_failed: ['rate<0.10'],
  },
};

export default function () {
  // Cada petición tarda 500 ms en el backend: con muchos usuarios se acumulan.
  const r = http.get(`${BASE_URL}/slow?ms=500`);
  check(r, { 'status 200': (x) => x.status === 200 });
}

# Proyecto Final – Infraestructura Containerizada con Balanceo de Carga y Monitoreo

**Administración de Sistemas Operativos – Universidad Autónoma de Occidente (UAO)**

Infraestructura desplegada en contenedores Docker que integra **Nginx** como proxy inverso y balanceador de carga (round-robin), **tres instancias independientes de un backend en Node.js** instrumentadas con métricas de Prometheus, y una pila completa de observabilidad con **Prometheus**, **Grafana**, **Nginx Prometheus Exporter** y **cAdvisor**.

## Integrantes

- [Nombre Integrante 1]
- [Nombre Integrante 2]
- [Nombre Integrante 3]

---

## 1. Arquitectura de la infraestructura

Un solo comando (`docker compose up -d --build`) despliega **8 contenedores** interconectados a través de la red Docker personalizada `monitoring-net`:

```text
                       HOST (Máquina física)
 Navegador / curl / k6 ──► localhost:8080
 Prometheus ► localhost:9090   Grafana ► localhost:3001   cAdvisor ► localhost:8082

 ┌──────────────────── Red Docker: monitoring-net ─────────────────────┐
 │            ┌──► backend1 :3000 ("server 1") ─┐                      │
 │  nginx:80 ─┼──► backend2 :3000 ("server 2") ─┼─ /metrics ◄─┐        │
 │     │      └──► backend3 :3000 ("server 3") ─┘             │ scrape │
 │     │ :8081/stub_status (solo interno)                     │        │
 │     ▼                                                      │        │
 │  nginx-exporter :9113 ◄──────── scrape ────────── prometheus :9090  │
 │  cadvisor :8080 ◄────────────── scrape ───────────────┘    ▲        │
 │                                                   PromQL   │        │
 │                                                     grafana :3000   │
 └─────────────────────────────────────────────────────────────────────┘
```

| Servicio | Imagen | Puerto interno | URL en el host | Función |
|---|---|---|---|---|
| `backend1`, `backend2`, `backend3` | `proyecto-backend:1.0` (local) | `3000` | No publicado | API Node.js + Express que identifica la instancia y expone `/metrics` |
| `nginx` | `nginx:1.27-alpine` | `80` y `8081` | http://localhost:8080 | Proxy inverso, balanceador round-robin y endpoint interno `/stub_status` |
| `nginx-exporter` | `nginx/nginx-prometheus-exporter:1.4.2` | `9113` | No publicado | Traduce `/stub_status` de Nginx al formato de Prometheus |
| `cadvisor` | `ghcr.io/google/cadvisor:0.56.2` | `8080` | http://localhost:8082 | Recolecta uso de recursos (CPU, memoria, red y disco) por contenedor |
| `prometheus` | `prom/prometheus:v3.13.5` | `9090` | http://localhost:9090 | Recolecta y almacena series de tiempo cada 5 s desde los 6 targets |
| `grafana` | `grafana/grafana:12.4.0` | `3000` | http://localhost:3001 | Visualización automática mediante datasource y dashboard provisionados |

### Endpoints del backend

| Endpoint | Descripción |
|---|---|
| `GET /` | Devuelve HTML (`<h1>Hello from server N</h1>` + hostname del contenedor) y cabecera `X-Backend` |
| `GET /health` | Healthcheck (`{"status":"ok","server":"server N"}`) usado por Docker |
| `GET /headers` | Muestra la IP vista por el backend y las cabeceras recibidas (`X-Forwarded-For`, `X-Real-IP`) |
| `GET /slow?ms=500` | Simula carga o trabajo con latencia controlada (en milisegundos) |
| `GET /metrics` | Expone métricas de Prometheus (`flask_http_request_total`, `flask_http_request_duration_seconds`, `app_info` y métricas de proceso). Bloqueado con `404` en el puerto público de Nginx |

---

## 2. Requisitos previos

- **Docker** y **Docker Compose v2** (`docker --version` y `docker compose version`).
- **Git** y utilidades de consola (`bash`, `curl`). En Windows se recomienda usar **WSL2 (Ubuntu)**.
- **Recursos:** al menos 4 GB de RAM asignados a Docker.
- **Puertos libres en el host:** `8080`, `9090`, `3001` y `8082` (si alguno está ocupado, se puede modificar en `.env`).
- **k6** (para ejecutar las pruebas de carga desde el host o mediante contenedor Docker).

---

## 3. Cómo levantar y verificar la infraestructura

### Paso 1: Clonar el repositorio y configurar variables de entorno

```bash
git clone https://github.com/<usuario>/ProyectoFinal-SO-.git
cd ProyectoFinal-SO-
cp .env.example .env
```

### Paso 2: Construir imágenes e iniciar los contenedores

```bash
docker compose up -d --build
docker compose ps
```

### Paso 3: Ejecutar la verificación automática

Espera ~15–20 segundos tras el arranque para que los healthchecks pasen a `healthy` y Prometheus complete su primer *scrape*, y ejecuta:

```bash
chmod +x scripts/verificar.sh
./scripts/verificar.sh
```

El script valida los 8 contenedores, la salud de los 3 backends, el reparto round-robin, el bloqueo `404` de `/metrics` en el proxy, la disponibilidad de Prometheus/Grafana/cAdvisor y que los **6 targets de Prometheus estén en estado `UP`**, finalizando con `TODO BIEN.`.

---

## 4. URLs de acceso desde el navegador

| Servicio | URL | Credenciales / Notas |
|---|---|---|
| **Aplicación Web (Nginx)** | http://localhost:8080 | Muestra `Hello from server N` |
| **Prometheus** | http://localhost:9090 | Ver targets en http://localhost:9090/targets (`6/6 UP`) |
| **Grafana** | http://localhost:3001 | Usuario: `admin` / Contraseña: `admin123` (o los definidos en `.env`). Abre directamente el dashboard **Proyecto Final - Infraestructura** |
| **cAdvisor** | http://localhost:8082 | Métricas de contenedores en tiempo real |

---

## 5. Cómo verificar el balanceo de carga y el proxy inverso

### 5.1 Rotación Round-Robin entre los 3 backends

Ejecuta 9 peticiones seguidas por consola (los navegadores suelen reutilizar la conexión TCP por *keep-alive*, por lo que `curl` permite observar la rotación exacta):

```bash
for i in $(seq 1 9); do curl -s http://localhost:8080/ | grep -o 'server [0-9]'; done
```

Salida esperada (alternando `server 1`, `server 2` y `server 3`):
```text
server 1
server 2
server 3
server 1
server 2
server 3
server 1
server 2
server 3
```

### 5.2 Inspección de cabeceras de balanceo y proxy

```bash
# Ver qué instancia y qué IP interna de contenedor respondió
curl -sI http://localhost:8080/ | grep -iE "x-backend|x-upstream"

# Comprobar que Nginx inyecta X-Real-IP y X-Forwarded-For hacia el backend
curl -s http://localhost:8080/headers

# Comprobar que /metrics no está expuesto públicamente a través de Nginx (debe devolver 404)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/metrics
```

---

## 6. Cómo ejecutar las pruebas de carga (k6)

El proyecto incluye dos escenarios en `loadtest/`:
- **`loadtest/k6-load.js` (Carga progresiva):** sube de 0 a 20, 50 y 100 usuarios virtuales (VUs) durante 2 min 30 s combinando peticiones a `/` y `/slow?ms=200`. Además contabiliza cuántas respuestas atendió cada backend (`respuestas_server1`, `respuestas_server2`, `respuestas_server3`) y valida umbrales (`p(95) < 800 ms` y errores `< 1%`).
- **`loadtest/k6-stress.js` (Estrés):** escala a 50, 150 y 300 VUs contra `/slow?ms=500` durante 2 minutos para observar el punto de saturación en Grafana.

### Opción A: Con k6 instalado en el host (Linux / WSL / macOS / Windows)

Instalar k6 en Ubuntu/WSL (si aún no está instalado):
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install -y k6
```

Ejecutar las pruebas y guardar los reportes en `docs/resultados/`:
```bash
mkdir -p docs/resultados

# 1. Prueba de carga progresiva
k6 run --summary-export=docs/resultados/k6-load-resumen.json \
  loadtest/k6-load.js 2>&1 | tee docs/resultados/k6-load.txt

# 2. Prueba de estrés
k6 run --summary-export=docs/resultados/k6-stress-resumen.json \
  loadtest/k6-stress.js 2>&1 | tee docs/resultados/k6-stress.txt
```

### Opción B: Ejecutar k6 con Docker (sin instalar nada en el host)

```bash
# En Linux con Docker nativo:
docker run --rm -i --network host -v "$PWD/loadtest:/scripts" grafana/k6:1.0.0 run /scripts/k6-load.js

# En Windows / macOS con Docker Desktop:
docker run --rm -i -e BASE_URL=http://host.docker.internal:8080 -v "$PWD/loadtest:/scripts" grafana/k6:1.0.0 run /scripts/k6-load.js
```

### Opción C: Tráfico rápido con `curl` (sin k6)

Para poblar rápidamente las gráficas de Grafana durante ~20 segundos:
```bash
seq 1 2000 | xargs -P 20 -I{} curl -s -o /dev/null "http://localhost:8080/slow?ms=200"
```

---

## 7. Pruebas adicionales: tolerancia a fallos y persistencia

### 7.1 Simulación de caída de un backend (alta disponibilidad)

Con una prueba de carga corriendo y Grafana abierto en http://localhost:3001:

```bash
# Apagar una instancia de backend
docker compose stop backend1
```
- En Grafana el panel **"Backends en UP"** baja de `3` a `2`.
- `backend2` y `backend3` absorben automáticamente el 50 % del tráfico cada uno.
- El panel **"Errores 5xx por segundo"** se mantiene en `0` gracias a que Nginx reintenta hacia los demás nodos del pool (`proxy_next_upstream`).

Para restaurar la instancia:
```bash
docker compose start backend1
```

### 7.2 Verificación de persistencia de datos (volúmenes Docker)

```bash
# Detiene y elimina contenedores conservando los volúmenes prometheus_data y grafana_data
docker compose down
docker compose up -d
```
Al volver a entrar a Prometheus y Grafana, el historial de métricas sigue intacto. Para un reinicio limpio desde cero (borrando volúmenes):
```bash
docker compose down -v
```

---

## 8. Estructura del repositorio

```text
ProyectoFinal-SO-/
├── .env.example                 # Plantilla de puertos y credenciales
├── .gitattributes               # Normalización de saltos de línea LF
├── .gitignore                   # Archivos excluidos de Git (.env, node_modules)
├── README.md                    # Documentación general y guía de ejecución
├── docker-compose.yml           # Orquestación de los 8 servicios, red y volúmenes
├── backend/
│   ├── Dockerfile               # Imagen Node 20 Alpine con usuario no-root y HEALTHCHECK
│   ├── .dockerignore
│   ├── app.js                   # API Express instrumentada con prom-client
│   ├── package.json
│   └── package-lock.json
├── nginx/
│   └── nginx.conf               # Proxy inverso, upstream round-robin y stub_status
├── prometheus/
│   └── prometheus.yml           # Configuración de scrape (6 targets cada 5 s)
├── grafana/
│   ├── provisioning/
│   │   ├── datasources/         # Conexión automática a Prometheus
│   │   └── dashboards/          # Proveedor automático de dashboards
│   └── dashboards/
│       └── proyecto-final.json  # Dashboard con 19 paneles (Estado, Backends, Nginx, cAdvisor)
├── loadtest/
│   ├── k6-load.js               # Prueba de carga progresiva (hasta 100 VUs)
│   └── k6-stress.js             # Prueba de estrés (hasta 300 VUs)
├── scripts/
│   └── verificar.sh             # Script automatizado de validación integral

```

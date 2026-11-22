# Proyecto final – Infraestructura containerizada con monitoreo

Administración de Sistemas Operativos – Universidad Autónoma de Occidente (UAO).

Infraestructura en Docker con **Nginx** como proxy inverso y balanceador de carga,
**tres instancias de un backend** (Node.js + Express) y un sistema de monitoreo con
**Prometheus**, **Grafana**, **Nginx Prometheus Exporter** y **cAdvisor**.

## Integrantes

- [COMPLETAR nombre 1]
- [COMPLETAR nombre 2]
- [COMPLETAR nombre 3]

## Arquitectura

```
Cliente (navegador / curl / k6) ──► Nginx :8080 ──┬──► backend1 (server 1)
                                                  ├──► backend2 (server 2)
                                                  └──► backend3 (server 3)

Prometheus :9090 recolecta cada 5 s:
  backend1/2/3 :3000/metrics · nginx-exporter :9113 · cAdvisor :8080 · sí mismo
Grafana :3001 dibuja los dashboards leyendo de Prometheus.
Todo corre en la red Docker "monitoring-net".
```

| Servicio | Imagen | URL en el host |
|---|---|---|
| `backend1..3` | `proyecto-backend:1.0` (se construye) | no publicado |
| `nginx` | `nginx:1.27-alpine` | http://localhost:8080 |
| `nginx-exporter` | `nginx/nginx-prometheus-exporter:1.4.2` | no publicado |
| `cadvisor` | `ghcr.io/google/cadvisor:0.56.2` | http://localhost:8082 |
| `prometheus` | `prom/prometheus:v3.13.5` | http://localhost:9090 |
| `grafana` | `grafana/grafana:12.4.0` | http://localhost:3001 |

### Endpoints del backend

| Endpoint | Qué hace |
|---|---|
| `GET /` | `Hello from server N` + hostname del contenedor |
| `GET /health` | `{"status":"ok"}` (healthcheck de Docker) |
| `GET /headers` | Cabeceras recibidas (demuestra `X-Forwarded-For`) |
| `GET /slow?ms=500` | Responde tras N ms (latencia controlada) |
| `GET /metrics` | Métricas Prometheus (bloqueado con 404 a través de Nginx) |

> Las métricas del backend usan los nombres `flask_http_request_total` y
> `flask_http_request_duration_seconds` (con etiqueta `backend`) a propósito: son
> los mismos que el backend Flask del laboratorio, así las consultas PromQL y los
> dashboards del laboratorio funcionan sin cambios aunque el backend sea Node.js.

## Requisitos previos

- Docker y Docker Compose v2 (`docker --version`, `docker compose version`)
- Git
- Puertos libres en el computador: 8080, 9090, 3001 y 8082 (se pueden cambiar en `.env`)
- Al menos 4 GB de memoria asignados a Docker
- Para las pruebas de carga desde el host: [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/)

## Cómo levantar

```bash
git clone https://github.com/<usuario>/ProyectoFinal-SO-.git
cd ProyectoFinal-SO-
cp .env.example .env
docker compose up -d --build
./scripts/verificar.sh
```

## URLs de acceso

| Servicio | URL | Notas |
|---|---|---|
| Aplicación (Nginx) | http://localhost:8080 | Alterna entre server 1, 2 y 3 |
| Prometheus | http://localhost:9090 | Status → Target health: 6 targets en UP |
| Grafana | http://localhost:3001 | Usuario y clave en `.env` (por defecto admin / admin123) |
| cAdvisor | http://localhost:8082 | Métricas por contenedor |

## Verificar el balanceo de carga

```bash
for i in $(seq 1 9); do curl -s localhost:8080/ | grep -o 'server [0-9]'; done
curl -sI localhost:8080/ | grep -iE "x-backend|x-upstream"
```

Debe verse `server 1`, `server 2`, `server 3` en rotación. (El navegador puede
reutilizar la conexión y mostrar siempre el mismo servidor; usa `curl`).

## Verificar el monitoreo

1. Abrir http://localhost:9090/targets y comprobar que hay 6 targets en UP.
2. Abrir http://localhost:3001: el dashboard "Proyecto Final - Infraestructura" carga solo.

## Pruebas de carga (k6)

```bash
k6 run loadtest/k6-load.js      # carga progresiva (hasta 100 VUs, ~2 min 30 s)
k6 run loadtest/k6-stress.js    # estrés (hasta 300 VUs, ~2 min)

# Guardando resultados:
k6 run --summary-export=docs/resultados/k6-load-resumen.json loadtest/k6-load.js
```

Mientras corre, observar el dashboard de Grafana. Resultados y capturas en `docs/`.

## Probar una falla

```bash
docker compose stop backend1    # Nginx sigue respondiendo con los otros dos
docker compose start backend1   # vuelve a recibir tráfico
```

## Detener y limpiar

```bash
docker compose down        # detiene; conserva los datos de Prometheus y Grafana
docker compose down -v     # además borra los volúmenes (reinicio total)
```

## Estructura del repositorio

```
backend/      API Node.js (app.js, package.json, Dockerfile)
nginx/        nginx.conf (proxy inverso, balanceo y stub_status)
prometheus/   prometheus.yml (targets)
grafana/      provisioning (datasource + proveedor) y dashboards JSON
loadtest/     scripts de k6
scripts/      verificar.sh
docs/         pasos, capturas, resultados, informe y video
```

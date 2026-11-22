#!/usr/bin/env bash
set -u

# Lee los puertos de .env si existe (si no, usa los valores por defecto).
[ -f .env ] && . ./.env
NGINX="http://localhost:${HOST_PORT_NGINX:-8080}"
PROM="http://localhost:${HOST_PORT_PROMETHEUS:-9090}"
GRAFANA="http://localhost:${HOST_PORT_GRAFANA:-3001}"
CADVISOR="http://localhost:${HOST_PORT_CADVISOR:-8082}"

fallos=0
ok()   { echo "  [OK]    $1"; }
mal()  { echo "  [FALLA] $1"; fallos=$((fallos + 1)); }

echo "1) Contenedores"
for c in backend1 backend2 backend3 nginx nginx-exporter cadvisor prometheus grafana; do
  estado=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo "no existe")
  [ "$estado" = "running" ] && ok "$c ($estado)" || mal "$c ($estado)"
done

echo "2) Salud de los backends"
for c in backend1 backend2 backend3; do
  salud=$(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null || echo "?")
  [ "$salud" = "healthy" ] && ok "$c healthy" || mal "$c $salud"
done

echo "3) Balanceo round-robin (9 peticiones)"
rotacion=$(for i in $(seq 1 9); do curl -s "$NGINX/" | grep -o 'server [0-9]'; done | sort | uniq -c | tr '\n' ' ')
echo "  Reparto: $rotacion"
[ "$(echo "$rotacion" | grep -o 'server' | wc -l)" -eq 3 ] && ok "las 3 instancias respondieron" || mal "no respondieron las 3 instancias"

echo "4) /metrics bloqueado en el proxy"
codigo=$(curl -s -o /dev/null -w "%{http_code}" "$NGINX/metrics")
[ "$codigo" = "404" ] && ok "devuelve 404" || mal "devolvió $codigo (se esperaba 404)"

echo "5) Servicios web"
for par in "Prometheus|$PROM/-/healthy" "Grafana|$GRAFANA/api/health" "cAdvisor|$CADVISOR/healthz"; do
  nombre=${par%%|*}; url=${par##*|}
  c=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  [ "$c" = "200" ] && ok "$nombre responde" || mal "$nombre devolvió $c"
done

echo "6) Targets de Prometheus (se esperan 6 en UP)"
# Pregunta a Prometheus cuántas series "up" valen 1 (cada target UP vale 1).
resp=$(curl -s "$PROM/api/v1/query?query=sum(up)")
arriba=$(echo "$resp" | sed -n 's/.*"value":\[[^,]*,"\([0-9]*\)".*/\1/p')
[ "${arriba:-0}" = "6" ] && ok "6 targets en UP" || mal "targets en UP: ${arriba:-0} (se esperaban 6; si recién arrancó, espera 15 s)"

echo
if [ "$fallos" -eq 0 ]; then echo "TODO BIEN."; else echo "Hubo $fallos fallo(s). Revisa la sección de problemas frecuentes."; exit 1; fi

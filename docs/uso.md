# Guía de Uso del Scraper

Este proyecto se ejecuta desde la terminal y está dividido en dos fases para maximizar la resiliencia y evitar bloqueos por parte del servidor.

## Iniciar el Script

Para ejecutar el programa interactivo, usa:
```bash
npm start
```
El script te hará algunas preguntas sobre tu entorno (VPN) y luego presentará un menú con dos opciones.

## Fase 1: Indexación

En esta fase, el scraper:
1. Navega por la página de inicio para obtener una sesión (Cookie y ViewState).
2. Simula clicks para extraer resultados de la Corte Suprema y la Corte Superior.
3. Extrae la metainformación de los documentos (título, expediente, URL del PDF) sin descargarlos.
4. Guarda el progreso en `data/todos_los_documentos.json` y `data/state.json`.

**Recuperación de errores:** Si la cookie expira y lanza Error 500, el scraper guarda en qué página se quedó (`state.json`). Solo debes reiniciar el script y retomar desde ahí.

## Fase 2: Descarga de PDFs

En esta fase, el scraper lee el JSON generado en la Fase 1:
1. Filtra los documentos con estado `pendiente`.
2. Intenta descargar el PDF en `data/pdfs/`.
3. Utiliza "Exponential Backoff" (reintentos con demoras incrementales de 2s, 4s, 8s) si detecta que la red falla o está limitada (Error 429).
4. Actualiza el estado a `completado` o `sin_pdf`.

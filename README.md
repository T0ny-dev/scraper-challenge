# Scraper de Jurisprudencia (PJ - Perú)

Scraper automatizado y tolerante a fallos para extraer y descargar resoluciones judiciales desde el portal público de Jurisprudencia del Poder Judicial del Perú.

El código ha sido estructurado siguiendo buenas prácticas y el **Principio de Responsabilidad Única (SRP)** para facilitar su mantenimiento, extensión y pruebas.

## Funcionamiento Breve y Limitaciones

El sistema interactúa con un servidor basado en JavaServer Faces (JSF), el cual es estricto con el manejo de estado (`ViewState`) y requiere el envío persistente de una cookie (`JSESSIONID`) atada a la IP de origen.

**Limitaciones Conocidas:**
El servidor cuenta con fuertes medidas de seguridad (WAF) que bloquean rápidamente IPs con alta frecuencia de peticiones, retornando errores de conexión o forzando la expiración de la sesión (Error 500).

**Soluciones Implementadas:**
- **Proxies Automáticos y Manuales:** El sistema incluye un gestor interno (`ProxyManager`) que automáticamente busca y evalúa proxies públicos gratuitos ubicados en Perú a través de APIs de scraping de proxies. Adicionalmente, se pueden agregar IPs manualmente en el archivo `data/proxies.txt`. La rotación es automática frente a baneos. Sin embargo, dado que los proxies gratuitos son volátiles, la velocidad de descarga puede ser inestable.
- **VPN (Recomendado):** Se ha **PROBADO CON Urban VPN** y funciona satisfactoriamente. Usar una conexión VPN directa desde el equipo host ofrece mayor velocidad y estabilidad que la rotación de proxies públicos gratuitos.
- **Resiliencia de Red (Exponential Backoff):** Las peticiones manejan de manera autónoma los bloqueos por límite de tasa (HTTP 429) pausando dinámicamente la ejecución, y detectan de inmediato sesiones caducadas (HTTP 500) para forzar una rotación de proxy sin interrumpir el flujo masivo.

## Documentación Detallada

Para mantener este README ligero, la documentación profunda ha sido separada en los siguientes archivos (ubicados en la carpeta `docs/`):

1. **[Arquitectura (arquitectura.md)](docs/arquitectura.md)**: Explica la estructura de carpetas, las clases de servicios y el flujo de la información.
2. **[Manejo de JSF y Sesión (sesion_y_jsf.md)](docs/sesion_y_jsf.md)**: Detalla la lógica técnica necesaria para lidiar con JSF, el `ViewState` y los errores de expiración de cookie.
3. **[Guía de Uso (uso.md)](docs/uso.md)**: Instrucciones detalladas de cómo operar las Fases de Indexación y Descarga.
4. **[Desarrollo y Testing (desarrollo_y_tests.md)](docs/desarrollo_y_tests.md)**: Instrucciones de pruebas unitarias y gestión de proxies.

## Requisitos

- Node.js v18+
- TypeScript / ts-node

## Instalación

```bash
npm install
```

## Uso Rápido

Ejecuta el menú principal interactivo:

```bash
npm start
```
*Si deseas más información sobre cómo funciona internamente la ejecución, revisa la [Guía de Uso](docs/uso.md).*

## Ejemplos de Salida

### 1. Interfaz de Consola
El scraper fue diseñado para emitir _logs_ completamente profesionales y auto-explicativos:

```text
=============================================
=== Scraper de Jurisprudencia PJ ===

[Configuración de Red]
¿Tienes una VPN activa en tu red actual?
Si respondes "NO", el script buscará proxies gratuitos de Perú...
(S/N) [S por defecto]: N

[Info] Buscando proxies públicos de Perú para evadir el bloqueo...
[Proxy] Probando (1/37): 38.172.129.168:999...
[Proxy] Proxy funcional verificado y seleccionado: http://190.43.59.75:999

=============================================
[Fase 1] Iniciando Indexación para: Corte Suprema
[Info] Realizando búsqueda con palabra clave: "" y corte: "1"...
[Info] Agregados 15 nuevos documentos (Total indexados: 15).

--- Corte Suprema - Página 2 (15 docs encontrados) ---
[Info] Agregados 15 nuevos documentos (Total indexados: 30).
```

### 2. Estructura de Datos (JSON)
Los metadatos extraídos se guardan en el archivo `data/todos_los_documentos.json`. Utilizamos el `uuid` nativo del servidor como _Key_ del diccionario para garantizar búsquedas en O(1) y evitar duplicados:

```json
{
  "2230b4da-33db-4654-8c87-93e13d11b3b1": {
    "uuid": "2230b4da-33db-4654-8c87-93e13d11b3b1",
    "titulo": "R.N. N° 639-2023",
    "recurso": "RECURSO DE NULIDAD",
    "nroexp": "00639-2023-0-5001-SU-PE-01",
    "organoJurisdiccional": "CORTE SUPREMA DE JUSTICIA",
    "sala": "SALA PENAL TRANSITORIA",
    "fechaResolucion": "2024-03-12 00:00:00.0",
    "tipoResolucion": "RESOLUCIONES",
    "pdfUrl": "https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/descarga.xhtml?uuid=2230b4da-...",
    "id": 1,
    "status": "completado",
    "ruta_local": "c:\\ruta\\data\\pdfs\\1_recurso_de_nulidad_00639_2023...pdf"
  }
}
```

## Pruebas de Integración

El proyecto incluye pruebas automatizadas con Jest para asegurar que la inyección de Agentes (SOCKS y HTTPS) y la lógica de negocio funcionen correctamente:

```bash
npm test
```

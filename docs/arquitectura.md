# Arquitectura del Scraper

Este documento describe cómo está estructurado el scraper tras la refactorización para cumplir con los principios SOLID (específicamente SRP - Principio de Responsabilidad Única).

## Estructura de Directorios

```text
src/
├── models/
│   └── DocumentoPJ.ts        # Interfaz de datos
├── parsers/
│   └── HtmlParser.ts         # Extracción de datos del HTML y manejo del estado JSF
├── services/
│   ├── HttpService.ts        # Manejo de cliente Axios y proxies
│   ├── SessionService.ts     # Obtención de cookie inicial
│   └── DownloadService.ts    # Lógica de descarga de PDFs
├── scraper.ts                # Fachada principal (Orquestador)
├── index.ts                  # Punto de entrada CLI
└── proxy.ts                  # Manejador de proxies
```

## Flujo de Datos

1. **Inicialización**: `JurisprudenciaScraper` instancia a `HttpService` configurando los proxies necesarios.
2. **Búsqueda**: Se hace una petición GET. El HTML es enviado a `HtmlParser` para extraer el `ViewState` y los inputs.
3. **Paginación**: Similar a la búsqueda, pero se inyectan los spinners al parser y se hace POST enviando todo el estado.
4. **Descarga**: `DownloadService` usa la instancia de `HttpService` para descargar los PDFs con política de reintentos exponenciales.

Esta separación facilita las pruebas unitarias y el mantenimiento del código.

# Desarrollo y Testing

Esta sección detalla cómo contribuir, realizar pruebas y cómo funciona el sistema de proxies.

## Tests Unitarios

Los tests están escritos en [Jest](https://jestjs.io/es-ES/). Se han configurado para asegurar la funcionalidad básica sin saturar al servidor externo.

Para ejecutar los tests:
```bash
npm run test
```

## Sistema de Proxies

Si el usuario indica que **NO tiene VPN**, el `index.ts` usa el `ProxyManager` (`src/proxy.ts`):
1. Extrae proxies gratuitos de APIs públicas.
2. Los valida haciendo peticiones a un endpoint confiable.
3. Asigna un proxy válido a la variable de entorno `PROXY_URL`.
4. El `HttpService` detecta esta variable e inyecta dinámicamente un agente HTTP/SOCKS.

Si durante la Fase 1 el proxy actual colapsa y devuelve un timeout, el scraper automáticamente bloquea ese proxy y rota al siguiente disponible.

## Reglas para contribuir
- Mantener el principio de Responsabilidad Única.
- Documentar todas las funciones complejas en español.
- Si modificas JSF/Mojarra, asegúrate de actualizar el parser en `HtmlParser.ts`.

# Manejo de Sesión y JSF (JavaServer Faces)

El portal de Jurisprudencia del Poder Judicial del Perú está construido con JSF (Mojarra). Esto significa que **no tiene una API REST**. Toda la navegación se basa en mantener el estado de la vista (`ViewState`) y una sesión activa (`JSESSIONID`).

## ¿Qué es el ViewState?

Es un campo oculto (`javax.faces.ViewState`) que JSF inyecta en cada HTML devuelto. Contiene el estado del componente del servidor.
**Regla de Oro**: Para hacer una petición POST válida en JSF, SIEMPRE debes enviar el `ViewState` de la petición GET o POST inmediatamente anterior.

## ¿Por qué falla con Error 500?

El Error 500 ocurre comúnmente cuando:
1. La cookie `JSESSIONID` caducó por inactividad.
2. El servidor reinició su memoria o eliminó tu ViewState por exceso de carga.
3. Enviaste un POST con un ViewState desactualizado o de otra página.

## Solución implementada

- **HtmlParser**: Extrae recursivamente TODOS los `<input>` y `<select>` del HTML anterior para re-enviarlos en el siguiente POST.
- **SessionService**: Renueva dinámicamente el JSESSIONID analizando los headers `Set-Cookie`.

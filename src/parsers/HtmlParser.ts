import * as cheerio from 'cheerio';
import { DocumentoPJ } from '../models/DocumentoPJ';

/**
 * Clase encargada de analizar (parsear) el código HTML que nos devuelve la página.
 * Su propósito es ensuciarse las manos leyendo el HTML crudo para extraer la información valiosa
 * (como los expedientes y los parámetros ocultos del sistema JSF) y devolvérnosla estructurada.
 */
export class HtmlParser {
    /**
     * Busca los botones de "Ver Ficha" en el HTML y extrae el JSON oculto dentro de ellos.
     * @param htmlContent El código HTML completo devuelto por el servidor.
     * @returns Una lista limpia y estructurada de documentos (Resoluciones Judiciales).
     */
    public static parseHtmlToDocuments(htmlContent: string): DocumentoPJ[] {
        const $html = cheerio.load(htmlContent);
        const documents: DocumentoPJ[] = [];

        // JSF a veces guarda los datos en un atributo "onclick". Buscamos todos los enlaces que tengan "uuid".
        $html('a[onclick*="uuid"]').each((i, el) => {
            const onclickAttr = $html(el).attr('onclick') || '';
            // Usamos una expresión regular para pescar el fragmento JSON que está metido dentro del texto de javascript.
            const parametersMatch = onclickAttr.match(/\\?"parameters\\?":\s*(\{.*?\})\s*,/);

            if (parametersMatch) {
                try {
                    // Limpiamos la basura de escapes (\") para que sea un JSON válido que Node pueda entender.
                    let jsonStr = parametersMatch[1]
                        .replace(/\\"/g, '"')
                        .replace(/\\\\u002D/g, '-')
                        .replace(/\\u002D/g, '-')
                        .replace(/\\\\\//g, '/')
                        .replace(/\\\//g, '/');

                    const data = JSON.parse(jsonStr);

                    // Mapeamos los datos crudos a nuestra interfaz limpia DocumentoPJ
                    documents.push({
                        uuid: data.uuid,
                        titulo: `${data.recurso} - Exp: ${data.nroexp}`,
                        recurso: data.recurso || '',
                        nroexp: data.nroexp || '',
                        fechaResolucion: data.fechaResolucion || '',
                        tipoResolucion: data.tipoResolucion || '',
                        sala: data.sala || '',
                        pretensiones: data.pretensiones || '',
                        normaDI: data.normaDI || '',
                        palabrasClave: data.palabras || '',
                        sumilla: data.sumilla || '',
                        // El portal siempre forma la ruta de descarga usando el UUID del archivo
                        pdfUrl: `https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/ServletDescarga?uuid=${data.uuid}`
                    });
                } catch (e) {
                    console.error('[Error] Falló al traducir la data cruda a un documento estructurado:', e);
                }
            }
        });

        console.log(`[Info] Parseo finalizado: Extraídos ${documents.length} documentos.`);
        return documents;
    }

    /**
     * JSF: Extrae TODOS los campos (inputs y selects) del formulario actual.
     * Esto es vital porque para pedir la siguiente página, el servidor nos obliga a reenviarle
     * su propio estado (ViewState y demás).
     * 
     * @param htmlContent HTML de la página actual.
     * @returns Un objeto con todos los campos listos para enviarse por POST.
     */
    public static extractFormParams(htmlContent: string): URLSearchParams {
        const $ = cheerio.load(htmlContent);
        const params = new URLSearchParams();

        // Buscamos cualquier input dentro del formulario principal
        $('form#formBuscador').find('input[name], select[name]').each((_, el) => {
            const name = $(el).attr('name');
            const type = $(el).attr('type');
            let val = $(el).val();

            if (name) {
                // Si es un checkbox que no está marcado, no lo enviamos (igual que haría un navegador real)
                if ((type === 'checkbox' || type === 'radio') && !$(el).is(':checked')) {
                    return;
                }
                // No enviamos los botones porque JSF se vuelve loco si cree que apretaste dos botones a la vez
                if (type === 'submit' || type === 'button') {
                    return;
                }
                params.append(name, val === undefined ? '' : (val as string));
            }
        });

        return params;
    }

    /**
     *  A veces el framework inyecta parámetros extra 
     * directamente en el botón de "Buscar". Esta función los pesca y los añade a nuestra lista de parámetros.
     */
    public static extractDynamicParams(htmlContent: string, params: URLSearchParams): void {
        const $ = cheerio.load(htmlContent);
        // Buscamos el botón de la lupa (buscar)
        const onclickAttr = $('input[src*="btn-buscar.png"]').first().attr('onclick') || '';
        // Extraemos los datos que Mojarra intenta enviar por debajo
        const match = onclickAttr.match(/mojarra\.jsfcljs.*?(\{.*?\})/);

        if (match) {
            let jsonStr = match[1].replace(/'/g, '"').replace(/\\"/g, '"');
            try {
                const dynamicParams = JSON.parse(jsonStr);
                for (const key in dynamicParams) {
                    params.set(key, dynamicParams[key]);
                }
            } catch (e) {
                console.warn('[Warn] JSF intentó enviar datos dinámicos, pero no pudimos leerlos:', jsonStr);
            }
        }
    }

    /**
     * Busca el nombre exacto del botón "IR" (usado para paginar) en el HTML.
     * Como el nombre del botón cambia dinámicamente, tenemos que buscarlo por su valor de texto ('IR').
     */
    public static findButtonIrName(htmlContent: string): string {
        let btnIrName = '';
        const $html = cheerio.load(htmlContent);
        $html('input[type="submit"], input[type="button"]').each((_, el) => {
            const val = $html(el).val() as string;
            if (val === 'IR') {
                btnIrName = $html(el).attr('name') || '';
            }
        });
        return btnIrName;
    }
}

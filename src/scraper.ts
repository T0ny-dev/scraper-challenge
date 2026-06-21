import * as fs from 'fs';
import * as path from 'path';
import { DocumentoPJ } from './models/DocumentoPJ';
import { HttpService } from './services/HttpService';
import { SessionService } from './services/SessionService';
import { DownloadService } from './services/DownloadService';
import { HtmlParser } from './parsers/HtmlParser';
import { AxiosInstance } from 'axios';
import { withRetry } from './utils';

/**
 * Clase principal (Facade) para la interacción con el portal web de Jurisprudencia.
 * Coordina los servicios de sesión, red y descarga, encapsulando la lógica 
 * de navegación JSF.
 */
export class JurisprudenciaScraper {
    private httpService: HttpService;
    private initUrl = 'https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml';

    // Aquí guardamos temporalmente el HTML de la última página que visitamos
    // Es vital para poder paginar después (porque necesitamos extraer su ViewState)
    private lastHtml: string = '';

    /**
     * Levanta al director de orquesta y le da sus herramientas.
     * @param cookieString Cadena de sesión (cookie) inicial, de existir.
     */
    constructor(cookieString: string = '') {
        this.httpService = new HttpService(cookieString);
    }

    /**
     * Expone el motor de red interno (Axios) para que podamos hacerle pruebas unitarias.
     */
    public get client(): AxiosInstance {
        return this.httpService.client;
    }

    /**
     * Delega la tarea de conseguir la galleta inicial a su especialista (SessionService).
     */
    public static async fetchInitialCookie(proxyUrl?: string): Promise<string | null> {
        return SessionService.fetchInitialCookie(proxyUrl);
    }

    /**
     * El corazón de la Fase 1. Va a la página de inicio, simula apretar el botón de "Buscar"
     * y nos trae los resultados de la primera página.
     * 
     * @param palabraClave Si queremos buscar "homicidio", "robo", etc. (Vacio para buscar todo)
     * @param corte ID de la corte: '1' para Suprema, '2' para Superior.
     * @returns Una lista limpia de documentos listos para guardar en JSON.
     */
    public async searchAndParse(palabraClave: string = '', corte: string = '0'): Promise<DocumentoPJ[]> {
        console.log(`[Info] Realizando búsqueda con palabra clave: "${palabraClave}" y corte: "${corte}"...`);

        // 1. Visitamos el inicio para que JSF nos asigne un ViewState inicial (estado fresco)
        const initResp = await this.client.get(this.initUrl);
        this.lastHtml = initResp.data;

        // 2. Extraemos los inputs ocultos para regenerar el estado de JSF
        const params = HtmlParser.extractFormParams(this.lastHtml);

        // 3. Sobrescribimos en los inputs lo que el usuario realmente quiere buscar
        params.set('formBuscador:txtBusqueda', palabraClave);
        params.set('formBuscador:buCorte', corte);

        // 4. Para atrapar parámetros adicionales escondidos en el botón
        HtmlParser.extractDynamicParams(this.lastHtml, params);

        console.log(`[Info] Enviando POST al servidor con ${Array.from(params.keys()).length} parámetros...`);

        let response = await withRetry(async () => {
            try {
                // Enviamos el formulario tal como lo haría Chrome
                return await this.client.post(this.initUrl, params.toString(), {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    maxRedirects: 0, // No queremos que Axios siga las redirecciones en automático, las queremos controlar
                    validateStatus: (status) => status >= 200 && status < 400
                });
            } catch (error: any) {
                // El servidor JSF a veces no nos da la página directamente, sino que nos dice:
                // "Ey, ve a esta otra dirección" (Status 302: Redirección)
                if (error.response && error.response.headers && error.response.headers.location) {
                    let redirectUrl = error.response.headers.location;
                    // Corrección de bug interno del servidor peruano: Nos mandan a HTTP, pero obligan HTTPS
                    if (redirectUrl.startsWith('http://')) {
                        redirectUrl = redirectUrl.replace('http://', 'https://');
                    }
                    console.log(`[Info] El servidor nos pidió saltar a otra URL: ${redirectUrl}`);
                    return await this.client.get(redirectUrl);
                }
                
                // Si el servidor nos arroja un error 500, significa que nuestra sesión (cookie) ya no sirve
                // o que el servidor estalló por dentro. Guardamos el error para depurar y abortamos.
                if (error.response && error.response.status === 500) {
                    if (error.response.data) {
                        fs.writeFileSync(path.join(__dirname, '..', 'data', 'error_500.html'), error.response.data);
                    }
                    error.noRetry = true; // Forzamos salida rápida para que Index.ts rote el proxy
                }
                throw error;
            }
        }, 3, 3000);

        // Manejo nativo de redirección 302 por si Axios no tiró error pero sí nos mandó redirección
        if (response && response.status === 302 && response.headers && response.headers.location) {
            let redirectUrl = response.headers.location;
            if (redirectUrl.startsWith('http://')) {
                redirectUrl = redirectUrl.replace('http://', 'https://');
            }
            console.log(`[Info] Redirección nativa atrapada hacia: ${redirectUrl}`);
            response = await this.client.get(redirectUrl);
        }

        if (!response) {
            throw new Error('Fallo crítico en la búsqueda inicial. El servidor no nos dio nada útil.');
        }

        // Guardamos el HTML resultante para usarlo después si queremos paginar a la hoja 2
        this.lastHtml = response.data;

        // Guardamos una copia en el disco duro para depuración en modo desarrollo
        const debugPath = path.join(__dirname, '..', 'data', 'resultado_post.html');
        if (!fs.existsSync(path.dirname(debugPath))) fs.mkdirSync(path.dirname(debugPath), { recursive: true });
        fs.writeFileSync(debugPath, this.lastHtml, 'utf-8');

        // Parseamos los resultados y se los entregamos listos al usuario
        return HtmlParser.parseHtmlToDocuments(this.lastHtml);
    }

    /**
     * Salta a una hoja específica de los resultados (Ej: Hoja 2, 3, 4...).
     * MUY IMPORTANTE: Solo funciona si acabas de hacer `searchAndParse` o un `paginate` anterior,
     * porque necesita el HTML viejo para extraer el ViewState actual.
     */
    public async paginate(pageNumber: number): Promise<DocumentoPJ[]> {
        console.log(`\n[Info] Ejecutando petición para avanzar a la hoja #${pageNumber}...`);

        if (!this.lastHtml) {
            throw new Error("Peligro: No hay memoria HTML de la página anterior. ¡Debes hacer searchAndParse primero!");
        }

        // Recuperamos todos los inputs de la página anterior
        const params = HtmlParser.extractFormParams(this.lastHtml);

        // Modificamos los "spinners" (esos cajoncitos donde dice en qué número de página vas)
        params.set('formBuscador:spinner', pageNumber.toString());
        params.set('formBuscador:spinner2', pageNumber.toString());

        // Buscamos cuál es el ID dinámico que Mojarra le puso al botón "IR" en esta página específica
        const btnIrName = HtmlParser.findButtonIrName(this.lastHtml);
        if (btnIrName) {
            params.append(btnIrName, 'IR');
            console.log(`[Debug] Parámetro de paginación (botón IR) identificado: ${btnIrName}`);
        } else {
            console.log(`[Warning] Ausencia de parámetro (botón IR). Procediendo con petición genérica.`);
        }

        console.log(`[Debug] Disparando el POST para saltar a la página ${pageNumber}.`);

        const response = await withRetry(async () => {
            try {
                // Disparamos directo a resultado.xhtml (ya no a inicio.xhtml)
                return await this.client.post('https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml', params.toString(), {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        // Algunos servidores revisan si vienes de la misma página para evitar bots
                        'Referer': 'https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml'
                    }
                });
            } catch (error: any) {
                // Si la sesión expiró (Error 500) lo arrojamos hacia arriba (sin reintento local) para que el sistema rote el proxy
                if (error.response && error.response.status === 500) {
                    error.noRetry = true;
                }
                throw error;
            }
        }, 3, 3000);

        if (!response) {
            throw new Error('Fallo crítico al intentar avanzar de página.');
        }

        // Actualizamos nuestra memoria HTML con esta nueva página
        this.lastHtml = response.data;
        const debugPath = path.join(__dirname, '..', 'data', `resultado_page_${pageNumber}.html`);
        fs.writeFileSync(debugPath, this.lastHtml, 'utf-8');

        // Devolvemos los documentos fresquitos
        return HtmlParser.parseHtmlToDocuments(this.lastHtml);
    }

    /**
     * Delega el trabajo pesado de descargar el PDF al DownloadService.
     */
    public async downloadPdf(doc: DocumentoPJ, outputPath: string, maxRetries: number = 3): Promise<boolean> {
        return DownloadService.downloadPdf(this.client, doc, outputPath, maxRetries);
    }
}

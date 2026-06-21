import axios, { AxiosInstance } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

/**
 * Este es nuestro motor de red personalizado.
 * Configura Axios para fingir ser un humano real (User-Agent), manejar proxies y 
 * lo más importante: mantener actualizada la cookie de sesión si el servidor nos la renueva.
 */
export class HttpService {
    /** La instancia del motor de red, lista para hacer peticiones GET y POST */
    public client: AxiosInstance;
    /** La llave de acceso actual que estamos usando */
    public cookieString: string;

    /**
     * Ensambla el motor de red con las llaves que le damos.
     * @param cookieString Nuestra sesión guardada (si la tenemos).
     */
    constructor(cookieString: string = '') {
        // Limpiamos y preparamos la cookie por si el usuario solo nos pasó el valor sin el "JSESSIONID="
        let formattedCookie = cookieString.trim();
        if (formattedCookie && !formattedCookie.includes('=')) {
            formattedCookie = `JSESSIONID=${formattedCookie}`;
        }
        this.cookieString = formattedCookie;

        // simulamos que somos un navegador,
        // que somos de Perú y que aceptamos todo tipo de archivos.
        let config: any = {
            withCredentials: true, // Importante para enviar cookies
            timeout: 60000,        // 1 minuto de paciencia
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/115.0.0.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'es-PE,es;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cookie': this.cookieString // Enviamos la cookie guardada en cada petición
            }
        };

        // Si tenemos un proxy configurado globalmente en el sistema, conectamos el tubo
        if (process.env.PROXY_URL) {
            if (process.env.PROXY_URL.startsWith('socks')) {
                config.httpsAgent = new SocksProxyAgent(process.env.PROXY_URL);
            } else {
                config.httpsAgent = new HttpsProxyAgent(process.env.PROXY_URL);
            }
            config.proxy = false; // Desactivamos la lógica de proxies nativos de Axios a favor de nuestros Agentes
        }

        // Creamos la instancia
        this.client = axios.create(config);

        // "Interceptor"
        // Cada vez que recibimos una respuesta del servidor, antes de dársela al script, revisamos
        // si el servidor nos regaló una cookie JSESSIONID nueva. la guardamos sigilosamente.
        this.client.interceptors.response.use((response) => {
            const setCookie = response.headers['set-cookie'];
            if (setCookie && setCookie.length > 0) {
                for (const c of setCookie) {
                    if (c.includes('JSESSIONID=')) {
                        this.cookieString = c.split(';')[0];
                        // Actualizamos para enviar esta NUEVA cookie en las futuras peticiones
                        this.client.defaults.headers.common['Cookie'] = this.cookieString;
                        break;
                    }
                }
            }
            return response;
        }, (error) => {
            // Si hay un error de red (Ej: Error 500 o Timeout), lo dejamos pasar
            return Promise.reject(error);
        });
    }
}

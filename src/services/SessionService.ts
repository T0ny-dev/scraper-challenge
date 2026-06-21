import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { withRetry } from '../utils';

/**
 * "interacción inicial" con el servidor (obtener la sesión).
 * y (la cookie JSESSIONID).
 */
export class SessionService {
    /**
     * Navega sigilosamente a la página de inicio para obtener la galleta (cookie) de sesión.
     * Esta función es muy importante cuando usamos proxies, ya que es el primer punto de contacto.
     * 
     * @param proxyUrl URL del proxy por el cual queremos enmascarar nuestra visita, si existe.
     * @returns Un texto con la cookie (ej: "JSESSIONID=123456...") o null .
     */
    public static async fetchInitialCookie(proxyUrl?: string): Promise<string | null> {
        try {
            console.log('[Info] Intentando inicializar negociación de sesión automáticamente...');

            // simulamos ser un navegador Chrome normal en Windows
            let config: any = {
                timeout: 60000, // Somos pacientes: esperamos hasta 60 segundos por una respuesta
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/115.0.0.0'
                }
            };

            // Si nos pasaron un proxy, le ponemos una máscara adicional a Axios
            if (proxyUrl) {
                if (proxyUrl.startsWith('socks')) {
                    config.httpsAgent = new SocksProxyAgent(proxyUrl);
                } else {
                    config.httpsAgent = new HttpsProxyAgent(proxyUrl);
                }
                config.proxy = false; // Le decimos a Axios que use nuestro Agent especial de proxys
            }

            // Hacemos la petición GET a la página de inicio con reintentos
            const response = await withRetry(
                () => axios.get('https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml', config),
                3,
                3000
            );

            // Revisamos los encabezados de respuesta que nos mandó el servidor
            if (response && response.headers) {
                const setCookie = response.headers['set-cookie']; // cookie
                if (setCookie && setCookie.length > 0) {
                    // Recorremos las cookies buscando la que importa: JSESSIONID
                    for (const cookie of setCookie) {
                        if (cookie.includes('JSESSIONID=')) {
                            // La cortamos por el punto y coma 
                            return cookie.split(';')[0];
                        }
                    }
                }
            }

            // Si llegamos aquí, entramos a la página pero el servidor no nos dio una cookie.
            return null;
        } catch (error: any) {
            console.error('[Error] Fallo persistente de red o sesión rechazada tras múltiples reintentos:', error.message);
            return null;
        }
    }
}

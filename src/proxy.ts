import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Manejador de conexiones a través de proxies.
 * Se encarga de proveer rotación de proxies leyendo fuentes locales y 
 * apis externas, manteniendo una lista de exclusión (blacklist) para nodos fallidos.
 */
export class ProxyManager {
    private static blacklistedProxies: Set<string> = new Set();

    /**
     * Añade un proxy a la lista de exclusión para no volver a utilizarlo.
     * @param proxyUrl URL o IP del proxy a excluir.
     */
    public static blacklist(proxyUrl: string) {
        this.blacklistedProxies.add(proxyUrl);
        // Guardamos también la versión sin protocolo por si acaso
        const raw = proxyUrl.replace('http://', '').replace('https://', '');
        this.blacklistedProxies.add(raw);
    }
    
    /**
     * Obtiene una lista de proxies de Perú y los va probando uno a uno
     * hasta encontrar un valiente que nos deje pasar.
     * Retorna la URL del proxy ganador o null si estamos fritos.
     */
    public static async findWorkingProxy(): Promise<string | null> {
        console.log('[Proxy] Obteniendo lista de proxies...');

        // Función interna que recorre una lista de proxies y los prueba
        const tryProxies = async (list: string[]): Promise<string | null> => {
            // Filtramos los que ya sabemos que no sirven
            list = list.filter(p => !this.blacklistedProxies.has(p));
            if (list.length === 0) return null;
            
            // No probaremos mil de golpe, solo tomaremos los primeros 50 para no hacer spam local
            const maxToTest = Math.min(list.length, 50);
            console.log(`[Proxy] Empezando prueba de hasta ${maxToTest} proxies (excluyendo los bloqueados)...`);
            
            for (let i = 0; i < maxToTest; i++) {
                const proxyIP = list[i];
                console.log(`[Proxy] Probando (${i+1}/${maxToTest}): ${proxyIP}...`);
                let proxyUrl = proxyIP;
                if (!proxyUrl.includes('://')) proxyUrl = `http://${proxyIP}`; // Asumimos HTTP si no dice nada
                
                // ¡La prueba de fuego!
                const isWorking = await this.testProxy(proxyUrl);
                if (isWorking) {
                    console.log(`[Proxy] Proxy funcional verificado y seleccionado: ${proxyUrl}`);
                    return proxyUrl;
                } else {
                    // Si falla la prueba, directo a la lista negra
                    this.blacklist(proxyIP);
                }
            }
            return null; // Ninguno de esta tanda sirvió
        };

        try {
            // FASE 1: Primero miramos en nuestra "Base de Datos Local" (el bloc de notas)
            let localProxies: string[] = [];
            const localProxiesPath = path.join(__dirname, '..', 'data', 'proxies.txt');
            if (fs.existsSync(localProxiesPath)) {
                console.log('[Proxy] Leyendo proxies personalizados desde tu archivo data/proxies.txt...');
                localProxies = fs.readFileSync(localProxiesPath, 'utf8')
                    .split('\n')
                    .map(p => p.trim())
                    .filter(p => p.length > 5 && !p.startsWith('#') && !p.startsWith('//'));
            }

            let workingProxy = await tryProxies(localProxies);
            if (workingProxy) return workingProxy;

            // FASE 2: Si los locales fallan, pedimos refuerzos a APIs gratuitas en internet
            console.log('[Proxy] Sin proxies locales válidos, consultando APIs públicas de Perú para obtener IPs frescas...');
            const apiUrls = [
                'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&country=pe',
                'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=PE&ssl=all&anonymity=all'
            ];

            // Bucle de la desesperación (Rotación infinita)
            while (true) {
                for (let i = 0; i < apiUrls.length; i++) {
                    try {
                        const response = await axios.get(apiUrls[i]);
                        // Las APIs suelen devolver texto plano separado por saltos de línea
                        const found = (response.data as string).split('\n').map(p => p.trim()).filter(p => p.length > 5);
                        if (found.length > 0) {
                            console.log(`[Proxy] Encontrados ${found.length} proxies en la API (Opción ${i + 1}).`);
                            workingProxy = await tryProxies(found);
                            if (workingProxy) return workingProxy;
                        }
                    } catch (err: any) {
                        console.log(`[Proxy] Falló la API en la opción ${i + 1}.`);
                    }
                }
                
                // Si llegamos aquí, es que TODAS las APIs de ProxyScrape devolvieron IPs inactivas o rechazadas.
                // Se aplica un tiempo de espera para evitar bloqueos por tasa de peticiones (rate-limit) antes de reintentar.
                console.log('[Warn] Todos los proxies de las APIs fallaron. Esperando 30 segundos para una nueva iteración de búsqueda...');
                await new Promise(r => setTimeout(r, 30000));
            }
        } catch (error: any) {
            console.error('[Proxy] Error fatal al obtener la lista de proxies:', error.message);
            return null;
        }
    }

    /**
     * Manda un "ping" a la página de inicio a través del proxy para ver si nos dejan pasar.
     * @param proxyUrl La URL del proxy a probar.
     * @returns True si pasamos, False si el proxy está muerto o baneado.
     */
    private static async testProxy(proxyUrl: string): Promise<boolean> {
        try {
            let agent;
            if (proxyUrl.startsWith('socks')) {
                agent = new SocksProxyAgent(proxyUrl);
            } else {
                agent = new HttpsProxyAgent(proxyUrl);
            }
            
            // Intentamos acceder a la puerta del Poder Judicial
            const testResp = await axios.get('https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml', {
                httpsAgent: agent,
                proxy: false, // Apagamos el soporte nativo malo de Axios
                timeout: 8000, // Le damos 8 segundos al proxy para que responda (tiempo razonable)
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/115.0.0.0'
                }
            });
            // Si nos devuelven un código 200 (OK), el proxy está vivito y coleando.
            return testResp.status === 200;
        } catch (e) {
            // Pudo ser un Rechazo (403 WAF), un Timeout porque está muy lento, o simplemente el proxy ya no existe.
            return false;
        }
    }
}

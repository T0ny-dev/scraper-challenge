import { JurisprudenciaScraper } from '../scraper';

/**
 * Conjunto de pruebas de validación e integración para el Scraper.
 * Garantizan que la configuración de red y agentes proxy se inicialicen 
 * correctamente sin alterar su comportamiento esperado.
 */
describe('JurisprudenciaScraper - Pruebas de Integridad', () => {

    // Prueba 1: Validación de inicialización de la clase principal
    // para confirmar que no existan errores de sintaxis o dependencias faltantes.
    it('debería poder instanciarse sin lanzar errores', () => {
        expect(() => {
            new JurisprudenciaScraper('dummy_cookie');
        }).not.toThrow();
    });

    // Prueba 2: Si el usuario configura un proxy de tipo SOCKS en las variables de entorno,
    // el scraper DEBE inyectar el Agente correcto para que el tráfico pase por ahí.
    it('debería configurar httpsAgent correctamente cuando el proxy en entorno es SOCKS', () => {
        process.env.PROXY_URL = 'socks4://127.0.0.1:1080';
        const scraper = new JurisprudenciaScraper('dummy_cookie');
        
        // Verificamos que Axios tenga un "httpsAgent" asignado
        expect(scraper.client.defaults.httpsAgent).toBeDefined();
        
        // Limpiamos la variable de entorno para no afectar otras pruebas
        delete process.env.PROXY_URL;
    });

    // Prueba 3: Similar a la anterior, pero para proxies HTTP normales.
    // Esto previene que una actualización de la librería de Axios o de los Agentes 
    // nos deje sin soporte para proxies públicos.
    it('debería configurar httpsAgent correctamente cuando el proxy en entorno es HTTP', () => {
        process.env.PROXY_URL = 'http://127.0.0.1:8080';
        const scraper = new JurisprudenciaScraper('dummy_cookie');
        
        // Verificamos que Axios haya atrapado la configuración del proxy HTTP
        expect(scraper.client.defaults.httpsAgent).toBeDefined();
        
        delete process.env.PROXY_URL;
    });

});

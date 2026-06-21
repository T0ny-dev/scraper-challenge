import fs from 'fs';
import path from 'path';

/**
 * Utilidades compartidas del proyecto.
 * Contiene funciones genéricas para manejo de retardos, reintentos con 
 * retroceso exponencial (Exponential Backoff) y operaciones I/O de JSON.
 */

/**
 * Suspende la ejecución asincrónica por un periodo definido de tiempo.
 * @param ms Tiempo de espera en milisegundos.
 */
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Ejecuta una operación (ej: descargar algo) y si falla, la vuelve a intentar
 * varias veces con pausas cada vez más largas (Exponential Backoff).
 * 
 * @param operation La función que queremos ejecutar.
 * @param maxRetries Número máximo de veces que lo intentaremos (por defecto 5).
 * @param baseDelay Pausa inicial en milisegundos antes del primer reintento (por defecto 2000).
 */
export async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 3000
): Promise<T> {
    let attempt = 0;
    while (true) {
        try {
            return await operation(); // ¡Intentamos la acción!
        } catch (error: any) {
            if (error.noRetry) {
                throw error;
            }

            // Fast-Fail: Si estamos usando un proxy y este se muere físicamente, abortamos los reintentos
            // para que index.ts pueda rotarlo inmediatamente en lugar de esperar 20 segundos.
            if (process.env.PROXY_URL) {
                const proxyDied = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH'].includes(error.code);
                if (proxyDied) {
                    console.warn(`[Warn] El proxy parece estar inalcanzable (${error.code}). Forzando rotación rápida...`);
                    throw error;
                }
            }

            attempt++;
            
            // Verificamos si el servidor nos bloqueó por intensos (429: Too Many Requests)
            const is429 = error.response && error.response.status === 429;
            
            if (is429) {
                // Si es un 429, respetamos el límite del servidor aplicando Exponential Backoff estricto
                // Matemáticas: 3s -> 6s -> 12s -> 24s...
                const delay = baseDelay * Math.pow(2, attempt - 1);
                console.warn(`[Warn] Límite de peticiones alcanzado (Error 429). Esperando ${delay}ms antes de reintentar...`);
                await sleep(delay);
            } else if (attempt <= maxRetries) {
                // Si es otro error de red y aún tenemos paciencia...
                const delay = baseDelay * Math.pow(2, attempt - 1);
                console.warn(`[Warn] Fallo en la petición (${attempt}/${maxRetries}). Reintentando en ${delay}ms... Detalle: ${error.message}`);
                await sleep(delay);
            } else {
                // Se superó el límite máximo de reintentos
                throw error;
            }
        }
    }
}

/**
 * Guarda cualquier objeto de Javascript en un archivo .json de forma bonita.
 * Si la carpeta no existe, la crea mágicamente.
 * 
 * @param filename Ruta completa del archivo a crear.
 * @param data Los datos a guardar.
 */
export function saveJson(filename: string, data: any) {
    const dir = path.dirname(filename);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    // El "null, 2" es el secreto para que el JSON quede tabulado y legible para humanos
    fs.writeFileSync(filename, JSON.stringify(data, null, 2), 'utf-8');
}

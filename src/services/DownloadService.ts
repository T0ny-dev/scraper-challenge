import * as fs from 'fs';
import { AxiosInstance } from 'axios';
import { DocumentoPJ } from '../models/DocumentoPJ';
import { withRetry } from '../utils';

/**
 * Servicio dedicado exclusivamente a descargar archivos pesados (como los PDFs).
 * Su principal característica es que es "resiliente", es decir, no se rinde fácilmente
 * si la red parpadea o si el servidor nos bloquea momentáneamente por pedir cosas muy rápido.
 */
export class DownloadService {
    /**
     * Descarga el PDF del documento indicado hacia tu disco duro.
     * Implementa una táctica llamada "Exponential Backoff" a través de withRetry.
     * 
     * @param client La instancia de red (Axios) configurada con nuestras cookies/proxies.
     * @param doc El documento del cual queremos descargar el PDF.
     * @param outputPath Ruta en tu disco donde guardaremos el PDF.
     * @param maxRetries Cuántas veces intentaremos descargarlo antes de darnos por vencidos (por defecto 3).
     * @returns True si el archivo se guardó sano y salvo, False si fracasó estrepitosamente.
     */
    public static async downloadPdf(client: AxiosInstance, doc: DocumentoPJ, outputPath: string, maxRetries: number = 3): Promise<boolean> {
        if (!doc.pdfUrl) {
            console.log(`[Warn] El documento "${doc.titulo}" no tiene un enlace PDF válido. Saltándolo.`);
            return false;
        }

        console.log(`[Info] Iniciando descarga del PDF: ${doc.titulo}...`);

        try {
            await withRetry(async () => {
                // Pedimos el archivo como un "stream" (chorro de datos) para no saturar la memoria RAM
                const response = await client.get(doc.pdfUrl!, {
                    responseType: 'stream',
                    maxRedirects: 5
                });

                // Abrimos el conducto hacia el disco duro
                const fileStream = fs.createWriteStream(outputPath);

                // Conectamos el chorro de datos de la red directamente al disco duro
                response.data.pipe(fileStream);

                // Esperamos pacientemente a que termine de escribirse el último byte
                await new Promise((resolve, reject) => {
                    fileStream.on('finish', () => resolve(true));
                    fileStream.on('error', reject);
                });
            }, maxRetries, 2000);

            return true; // ¡PDF está seguro en el disco!
        } catch (error: any) {
            // Algo malo pasó en la red y se agotaron los reintentos
            const status = error.response ? error.response.status : 'Network Error';
            console.error(`[Error Crítico] Límite de reintentos excedido. Fallo al descargar "${doc.titulo}" (Status: ${status}).`);
            return false;
        }
    }
}

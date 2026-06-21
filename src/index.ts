/**
 * Controlador principal de la aplicación CLI.
 * Orquesta el flujo de interacción con el usuario, la persistencia local de datos
 * y ejecuta las fases principales del scraper (Indexación y Descarga).
 */
import { JurisprudenciaScraper } from './scraper';
import { saveJson, sleep } from './utils';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { ProxyManager } from './proxy';

/**
 * Función auxiliar para capturar entrada del usuario mediante la consola.
 * @param query Mensaje a mostrar al usuario.
 * @returns Promesa que resuelve con la respuesta en texto.
 */
function askQuestion(query: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

/**
 * Recupera o negocia una sesión válida (cookie JSESSIONID) requerida por el WAF de Jurisprudencia.
 * Si detecta conexión por VPN, delega la extracción automática simple. 
 * Si opera con proxies, coordina la validación y rotación ante bloqueos de IP.
 * @returns La cadena de la cookie `JSESSIONID=...` validada.
 */
async function getCookie(): Promise<string> {
    const envPath = path.join(__dirname, '..', '.env');
    let lastCookie = '';
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/USER_COOKIE=(.*)/);
        if (match) lastCookie = match[1];
    }

    const hasVPN = process.env.USE_VPN === 'true';

    if (hasVPN) {
        console.log('[Info] Usando conexión directa (VPN). Intentando obtener sesión automáticamente...');
        const autoCookie = await JurisprudenciaScraper.fetchInitialCookie();
        if (autoCookie) {
            console.log(`[Info] Sesión obtenida automáticamente: ${autoCookie}`);
            fs.writeFileSync(envPath, `USER_COOKIE=${autoCookie}`);
            return autoCookie;
        } else {
            console.log('[Warn] No se pudo obtener la cookie con conexión directa. Pasando a ingreso manual.');
        }
    } else {
        console.log('[Info] Intentando obtener sesión automáticamente usando proxies...');
        let currentProxy = process.env.PROXY_URL;
        
        if (!currentProxy) {
            console.error(`[Error Crítico] No hay proxies disponibles en absoluto. Abortando.`);
            process.exit(1);
        }

        while (currentProxy) {
            const autoCookie = await JurisprudenciaScraper.fetchInitialCookie(currentProxy);
            if (autoCookie) {
                console.log(`[Info] Sesión obtenida automáticamente con proxy ${currentProxy}: ${autoCookie}`);
                fs.writeFileSync(envPath, `USER_COOKIE=${autoCookie}`);
                return autoCookie;
            } else {
                console.log(`[Warn] El proxy ${currentProxy} falló al obtener la sesión inicial. Rotando proxy...`);
                ProxyManager.blacklist(currentProxy);
                const nextProxy = await ProxyManager.findWorkingProxy();
                if (nextProxy) {
                    process.env.PROXY_URL = nextProxy;
                    currentProxy = nextProxy;
                    // Pequeña pausa de paciencia antes de forzar el nuevo proxy
                    await new Promise(r => setTimeout(r, 2000));
                } else {
                    console.error(`\n[Error Crítico] Se agotaron todos los proxies funcionales de la lista.`);
                    console.error(`[Info] Como no tienes VPN y usas proxies, es inútil que ingreses tu cookie manualmente (el servidor JSF detectaría el cambio de IP y la rechazaría).`);
                    console.error(`[Acción] Abortando proceso. Por favor, añade nuevos proxies en data/proxies.txt y vuelve a intentar.\n`);
                    process.exit(1);
                }
            }
        }
    }

    // El ingreso manual se ejecuta únicamente como respaldo si hasVPN es verdadero.
    console.log(`\n[Atención] Se requiere una sesión válida para extraer datos (Fase 1).`);
    console.log(`Cookie guardada actualmente: ${lastCookie ? lastCookie.substring(0, 50) + '...' : 'Ninguna'}`);
    
    const ans = await askQuestion('Pega tu Cookie nueva entera (o presiona Enter para usar la guardada): ');
    
    let rawInput = ans.trim();
    if (rawInput && !rawInput.includes('=')) {
        rawInput = `JSESSIONID=${rawInput}`;
    }

    let finalCookie = rawInput || lastCookie;
    
    if (rawInput) {
        fs.writeFileSync(envPath, `USER_COOKIE=${finalCookie}`);
        console.log('[Info] Cookie guardada en .env para la próxima vez.');
    }

    if (!finalCookie) {
        console.error('[Error] No se proporcionó ninguna cookie y no hay una guardada.');
        process.exit(1);
    }
    
    return finalCookie;
}

const dataFolder = path.join(__dirname, '..', 'data');
const pdfFolder = path.join(dataFolder, 'pdfs');
const jsonPath = path.join(dataFolder, 'todos_los_documentos.json');
const statePath = path.join(dataFolder, 'state.json');

if (!fs.existsSync(pdfFolder)) {
    fs.mkdirSync(pdfFolder, { recursive: true });
}

function loadAllDocuments(): Record<string, any> {
    if (fs.existsSync(jsonPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            if (Array.isArray(data)) {
                // Migración de formato Array legado a estructura de Diccionario
                const map: Record<string, any> = {};
                data.forEach(doc => {
                    if (!doc.status) doc.status = 'pendiente';
                    map[doc.uuid] = doc;
                });
                return map;
            }
            return data;
        } catch (e) {
            console.error('[Warn] No se pudo leer el JSON previo, iniciando vacío.');
        }
    }
    return {};
}

const safeFilename = (str: string) => str.replace(/[^a-z0-9]/gi, '_').toLowerCase().substring(0, 50);

/**
 * FASE 1: INDEXACIÓN DE METADATOS
 * Navega a través de las cortes (Suprema, Superior, etc.) extrayendo los UUIDs,
 * números de expedientes y resoluciones. Persiste el progreso en `state.json` 
 * para soportar reanudación segura ante cierres inesperados.
 */
async function runPhase1() {
    const USER_COOKIE = await getCookie();
    let scraper = new JurisprudenciaScraper(USER_COOKIE);

    const cortesToScrape = [
        { id: '1', name: 'Corte Suprema' },
        { id: '2', name: 'Corte Superior' }
    ];

    const MAX_PAGES = Infinity; 
    let allDocumentsMap = loadAllDocuments();
    let globalIdCount = Object.keys(allDocumentsMap).length;

    let savedState = { corteId: '1', page: 1 };
    if (fs.existsSync(statePath)) {
        try {
            savedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            console.log(`[Info] Estado recuperado: Corte ${savedState.corteId}, Página ${savedState.page}.`);
        } catch(e) {}
    }

    let resumeCorteIndex = cortesToScrape.findIndex(c => c.id === savedState.corteId);
    if (resumeCorteIndex === -1) resumeCorteIndex = 0;

    for (let i = resumeCorteIndex; i < cortesToScrape.length; i++) {
        const corte = cortesToScrape[i];
        console.log(`\n=============================================`);
        console.log(`[Fase 1] Iniciando Indexación para: ${corte.name}`);
        
        let documentos: any[] = [];
        try {
            documentos = await scraper.searchAndParse('', corte.id);
        } catch (e: any) {
            if (process.env.PROXY_URL) {
                console.log('\n[Warn] Fallo (o Error 500 de sesión) con el proxy actual durante la extracción. Iniciando rotación de proxy...');
                ProxyManager.blacklist(process.env.PROXY_URL);
                const newProxy = await ProxyManager.findWorkingProxy();
                if (newProxy) {
                    process.env.PROXY_URL = newProxy;
                    console.log(`[Info] Cambiando a nuevo proxy: ${newProxy}. Reintentando búsqueda...`);
                    const autoCookie = await JurisprudenciaScraper.fetchInitialCookie(newProxy);
                    if (autoCookie) {
                        const envPath = path.join(__dirname, '..', '.env');
                        fs.writeFileSync(envPath, `USER_COOKIE=${autoCookie}`);
                        scraper = new JurisprudenciaScraper(autoCookie);
                    } else {
                        scraper = new JurisprudenciaScraper(USER_COOKIE);
                    }
                    i--; // Decrementa para repetir el bucle con la misma corte
                    continue;
                } else {
                    console.error(`[Error] Falló la rotación de proxy. Ya no quedan proxies útiles.`);
                }
            } else if (e.response && e.response.status === 500) {
                console.error(`\n[Atención] 🚨 Cookie Inválida o Expirada (Error 500) 🚨\nEl servidor rechazó tu sesión.\n-> Solución: Abre una ventana de incógnito en tu navegador, ve a https://jurisprudencia.pj.gob.pe, copia una cookie fresca, y vuelve a correr 'npm start'.\n`);
            } else {
                console.error(`[Error] Falló la conexión inicial:`, e.message || e);
            }
            return; // Detenemos la Fase 1 de forma controlada
        }
        let currentPage = 1;

        if (i === resumeCorteIndex && savedState.page > 1) {
            console.log(`[Info] Saltando a la página ${savedState.page} guardada en estado...`);
            documentos = await scraper.paginate(savedState.page);
            currentPage = savedState.page;
        }

        while (documentos.length > 0 && currentPage <= MAX_PAGES) {
            console.log(`\n--- ${corte.name} - Página ${currentPage} (${documentos.length} docs encontrados) ---`);

            let agregadosEnPagina = 0;

            for (let j = 0; j < documentos.length; j++) {
                const doc = documentos[j];
                
                if (allDocumentsMap[doc.uuid]) {
                    // Ya existe en la base de datos
                    continue;
                }

                globalIdCount++;
                doc.id = globalIdCount;
                doc.status = 'pendiente'; // Nuevo status
                
                allDocumentsMap[doc.uuid] = doc;
                agregadosEnPagina++;
            }

            console.log(`[Info] Agregados ${agregadosEnPagina} nuevos documentos (Total indexados: ${Object.keys(allDocumentsMap).length}).`);
            
            saveJson(jsonPath, allDocumentsMap);
            fs.writeFileSync(statePath, JSON.stringify({ corteId: corte.id, page: currentPage }));

            currentPage++;
            if (currentPage <= MAX_PAGES) {
                // Retardo (throttling) para control de concurrencia y mantenimiento de estado de sesión.
                await sleep(1000);
                try {
                    documentos = await scraper.paginate(currentPage);
                } catch (e: any) {
                    if (process.env.PROXY_URL) {
                        console.log('\n[Warn] El proxy falló en la paginación (o Error 500). Ejecutando rotación de proxy...');
                        ProxyManager.blacklist(process.env.PROXY_URL);
                        const newProxy = await ProxyManager.findWorkingProxy();
                        if (newProxy) {
                            process.env.PROXY_URL = newProxy;
                            console.log(`[Info] Transición a proxy: ${newProxy}. Reintentando paginación...`);
                            const autoCookie = await JurisprudenciaScraper.fetchInitialCookie(newProxy);
                            if (autoCookie) {
                                const envPath = path.join(__dirname, '..', '.env');
                                fs.writeFileSync(envPath, `USER_COOKIE=${autoCookie}`);
                                scraper = new JurisprudenciaScraper(autoCookie);
                            } else {
                                scraper = new JurisprudenciaScraper(USER_COOKIE);
                            }
                            // El nuevo scraper carece del ViewState actual.
                            // Se requiere una consulta inicial para regenerar el ViewState antes de reanudar la paginación.
                            console.log('[Info] Regenerando estado interno JSF (ViewState)...');
                            await scraper.searchAndParse('', corte.id);
                            
                            currentPage--; // Retrocedemos la cuenta para reintentar la misma hoja
                            continue;
                        } else {
                            console.error(`[Error] No quedan proxies útiles para reanudar la paginación.`);
                            documentos = [];
                        }
                    } else if (e.response && e.response.status === 500) {
                        console.error(`\n[Atención] 🚨 ¡Tu sesión ha expirado (Error 500)! 🚨\nEl servidor JSF cerró la conexión por inactividad o seguridad.\nNo te preocupes, tu progreso hasta la página ${currentPage - 1} está guardado en state.json.\n\n-> Solución: Abre una ventana de incógnito en tu navegador, copia una cookie nueva, y vuelve a correr 'npm start'. El script reanudará exactamente desde donde se quedó.\n`);
                        documentos = []; // Interrumpir flujo para avanzar o terminar
                    } else {
                        console.error(`[Error] Falló la paginación a la hoja ${currentPage}:`, e.message || e);
                        documentos = []; // Rompemos el while para avanzar a la siguiente corte o terminar
                    }
                }
            }
        }
    }
    console.log(`\n[Info] Fase 1 Completada. Total documentos indexados: ${Object.keys(allDocumentsMap).length}.`);
}

/**
 * FASE 2: DESCARGA DE DOCUMENTOS
 * Itera sobre el diccionario global buscando documentos en estado 'pendiente'.
 * Ejecuta la descarga segura de PDFs manejando rotación de proxy ante fallas y
 * persistiendo el estado individual de cada documento tras el éxito.
 */
async function runPhase2() {
    console.log(`\n=============================================`);
    console.log(`[Fase 2] Iniciando Descarga de PDFs Pendientes`);
    
    // Obtener una cookie fresca (usando VPN o el Proxy configurado).
    // El servidor WAF requiere consistencia entre IP y cookie para permitir descargas.
    let USER_COOKIE = await getCookie();
    let scraper = new JurisprudenciaScraper(USER_COOKIE);

    let allDocumentsMap = loadAllDocuments();
    let documentosKeys = Object.keys(allDocumentsMap);
    
    let pendientes = documentosKeys.filter(uuid => allDocumentsMap[uuid].status === 'pendiente');
    console.log(`[Info] Se encontraron ${pendientes.length} documentos pendientes de descarga.`);

    for (let i = 0; i < pendientes.length; i++) {
        const uuid = pendientes[i];
        const doc = allDocumentsMap[uuid];

        if (doc.pdfUrl) {
            const sRecurso = safeFilename(doc.recurso || 'doc');
            const sExp = safeFilename(doc.nroexp || 'sin_exp');
            const sTipo = safeFilename(doc.tipoResolucion || 'res');
            const sSala = safeFilename(doc.sala || 'sala');
            
            const pdfPath = path.join(pdfFolder, `${doc.id}_${sRecurso}_${sExp}_${sTipo}_${sSala}.pdf`);
            
            let success = await scraper.downloadPdf(doc, pdfPath);
            
            // Si la descarga falla y estamos usando proxy, rotamos
            if (!success && process.env.PROXY_URL) {
                console.log('\n[Warn] Fallo de conexión con el proxy actual durante la descarga. Iniciando rotación de proxy...');
                ProxyManager.blacklist(process.env.PROXY_URL);
                const newProxy = await ProxyManager.findWorkingProxy();
                if (newProxy) {
                    process.env.PROXY_URL = newProxy;
                    console.log(`[Info] Transición a proxy: ${newProxy}. Intentando reconexión...`);
                    // Obtenemos una nueva sesión que corresponda a la IP del nuevo proxy
                    USER_COOKIE = await getCookie();
                    scraper = new JurisprudenciaScraper(USER_COOKIE);
                    
                    console.log(`[Info] Reintentando descarga de "${doc.titulo}" con nuevo proxy...`);
                    success = await scraper.downloadPdf(doc, pdfPath);
                } else {
                    console.error(`[Error] No quedan proxies útiles para continuar las descargas.`);
                    break; // Cortamos el bucle si no hay internet/proxies
                }
            }
            
            if (success) {
                console.log(`[OK] (${i+1}/${pendientes.length}) Guardado: ${path.basename(pdfPath)}`);
                doc.status = 'completado';
                doc.ruta_local = pdfPath;
                // Guardar JSON inmediatamente para persistir progreso
                saveJson(jsonPath, allDocumentsMap);
            } else {
                console.error(`[Fallo] (${i+1}/${pendientes.length}) No se pudo descargar: ${doc.titulo}. Permanecerá pendiente.`);
            }
            
            // Retraso para no saturar ancho de banda
            await sleep(2000);
        } else {
            console.log(`[Skip] Documento sin PDF: ${doc.titulo}`);
            doc.status = 'sin_pdf';
            saveJson(jsonPath, allDocumentsMap);
        }
    }

    console.log(`\n[Info] Fase 2 Completada.`);
}

/**
 * Punto de entrada de la aplicación CLI.
 * Define la topología de la red (VPN vs Proxies) guiada por el usuario
 * y delega la ejecución de la fase correspondiente (Indexación o Descarga).
 */
async function main() {
    console.log('\n=============================================');
    console.log('=== Scraper de Jurisprudencia PJ ===');
    
    console.log('\n[Configuración de Red]');
    console.log('¿Tienes una VPN activa en tu red actual?');
    console.log('Si respondes "NO", el script buscará proxies gratuitos de Perú, conectará en uno y extraerá la sesión automáticamente.');
    const vpnAns = await askQuestion('(S/N) [S por defecto]: ');
    const hasVPN = vpnAns.trim().toLowerCase() === 's' || vpnAns.trim().toLowerCase() === 'si' || vpnAns.trim() === '';
    
    process.env.USE_VPN = hasVPN ? 'true' : 'false';

    if (!hasVPN) {
        console.log('\n[Info] Buscando proxies públicos de Perú para evadir el bloqueo...');
        const workingProxy = await ProxyManager.findWorkingProxy();
        if (workingProxy) {
            process.env.PROXY_URL = workingProxy;
            console.log(`[Info] Proxy configurado globalmente: ${workingProxy}`);
        } else {
            console.log('[Warn] Falló la conexión por proxy. Intentaremos modo directo (que podría dar 403).');
        }
    }

    console.log('\nOpciones:');
    console.log('1. Ejecutar Fase 1: Indexar Documentos (Navegar JSF)');
    console.log('2. Ejecutar Fase 2: Descargar PDFs Pendientes');
    
    const ans = await askQuestion('Elige una opción (1 o 2): ');
    const choice = ans.trim();

    try {
        if (choice === '1') {
            await runPhase1();
        } else if (choice === '2') {
            await runPhase2();
        } else {
            console.log('Opción no válida.');
        }
    } catch (error) {
        console.error('\n[Error crítico en el Scraper]:', error);
    } finally {
        console.log('\n=== Scraper Finalizado ===');
    }
}

main();

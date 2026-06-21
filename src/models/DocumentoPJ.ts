/**
 * Modelo que representa un documento (Resolución Judicial) extraído del portal.
 * Sirve como contrato para saber exactamente qué datos estamos guardando de cada expediente.
 */
export interface DocumentoPJ {
    /** Identificador numérico interno (autoincremental local) */
    id?: number;
    /** UUID único que nos da el servidor JSF para identificar el documento y su PDF */
    uuid: string;
    /** Título armado para fácil lectura (ej: Recurso - Exp: NroExp) */
    titulo: string;
    /** Tipo de recurso interpuesto (ej: Casación, Apelación) */
    recurso: string;
    /** Número de expediente oficial (ej: 00123-2023) */
    nroexp: string;
    /** Fecha en que se emitió la resolución */
    fechaResolucion: string;
    /** Qué tipo de resolución es (ej: Auto, Sentencia) */
    tipoResolucion: string;
    /** La sala judicial que emitió el fallo */
    sala: string;
    /** Pretensiones o motivos del recurso */
    pretensiones: string;
    /** Norma de Derecho Internacional aplicada, si la hay */
    normaDI: string;
    /** Palabras clave para el buscador interno del Poder Judicial */
    palabrasClave: string;
    /** Resumen (sumilla) del contenido de la resolución */
    sumilla: string;
    /** Enlace directo de descarga del PDF (construido a partir del UUID) */
    pdfUrl: string;
    /** Estado interno de descarga: 'pendiente', 'completado' o 'sin_pdf' */
    status?: string;
    /** Ruta donde guardamos el PDF físicamente en nuestro disco duro */
    ruta_local?: string;
}

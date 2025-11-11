/**
 * Payload de entrada para la lambda de consulta RUES
 */
export interface RuesPayload {
    identificationNumber: string;
    headless?: boolean;
}

/**
 * Resultado de la consulta RUES
 */
export interface RuesResult {
    success: boolean;
    data?: RuesData;
    error?: string;
}

/**
 * Datos extraídos de RUES
 */
export interface RuesData {
    nombre: string;
    tipo_empresa: string;
    identificacion?: string;
    numero_de_inscripcion?: string;
    categoria?: string;
    camara_de_comercio?: string;
    numero_de_matricula?: string;
    estado?: string;
    informacion_general?: Record<string, string>;
    actividad_economica?: Array<{ ciiu: string; description: string }>;
    representante_legal?: string;
}


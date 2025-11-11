import { handle } from '../src/application/get-rues-data';
import type { RuesPayload } from '../src/domain/rues/interfaces';

export const handler = async (event: any) => {
    try {
        console.log('Event:', JSON.stringify(event, null, 2));
        
        // Normalizar el payload para asegurar tipos correctos
        const payload: RuesPayload = {
            identificationNumber: String(event.identificationNumber),
            headless: event.headless === true || event.headless === 'true' || event.headless === undefined ? true : false
        };
        
        console.log('Normalized payload:', JSON.stringify(payload, null, 2));
        
        const result = await handle(payload);
        
        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorCode = (error as any)?.code;
        
        console.error('Lambda error:', errorMessage);
        console.error('Error code:', errorCode);
        
        // Determinar el statusCode basado en el tipo de error
        let statusCode = 500; // Error del servidor por defecto
        
        if (errorCode === 'NOT_FOUND') {
            statusCode = 404; // Documento no encontrado
        } else if (errorCode === 'API_ERROR') {
            statusCode = 503; // Servicio no disponible (API de RUES caída)
        }
        
        return {
            statusCode,
            body: JSON.stringify({
                success: false,
                error: errorMessage,
                errorCode: errorCode || 'UNKNOWN_ERROR'
            })
        };
    }
};


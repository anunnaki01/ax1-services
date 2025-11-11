import { handle } from '../src/application/get-dian-cookie-by-certificate';
import type { Payload } from '../src/domain/dian/interfaces';

export const handler = async (event: Payload) => {
    try {
        console.log('Event:', JSON.stringify(event, null, 2));
        
        const result = await handle(event);
        
        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Lambda error:', errorMessage);
        
        return {
            statusCode: 500,
            body: JSON.stringify({
                success: false,
                error: errorMessage
            })
        };
    }
};


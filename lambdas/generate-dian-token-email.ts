import { handle } from '../src/application/generate-dian-token-email';
import type { DianTokenEmailPayload } from '../src/domain/dian/interfaces';

export const handler = async (event: any) => {
    try {
        console.log('Event:', JSON.stringify(event, null, 2));

        const payload: DianTokenEmailPayload = {
            identificationType: String(event.identificationType ?? event.CompanyIdentificationType ?? ''),
            userCode: String(event.userCode ?? event.UserCode ?? ''),
            companyCode: String(event.companyCode ?? event.CompanyCode ?? ''),
            origin: event.origin ? String(event.origin) : undefined,
            headless: normalizeBoolean(event.headless, true)
        };

        const result = await handle(payload);

        return {
            statusCode: result.success ? 200 : 400,
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

function normalizeBoolean(value: unknown, defaultValue: boolean): boolean {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'si'].includes(normalized)) {
            return true;
        }
        if (['false', '0', 'no'].includes(normalized)) {
            return false;
        }
    }

    return defaultValue;
}


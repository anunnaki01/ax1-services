// @ts-expect-error - No hay tipos disponibles para este paquete
import ac from "@antiadmin/anticaptchaofficial";
import axios from 'axios';

/**
 * Intenta resolver el captcha usando múltiples servicios
 */
export const resolveCaptcha = async (siteKey: string, pageUrl: string): Promise<string | null> => {
    console.log('\n🔐 Detectado Captcha Turnstile');
    console.log('   Site Key:', siteKey);

    // Intentar primero con AntiCaptcha
    let solution = await solveCaptchaAntiCaptcha(siteKey, pageUrl);

    // Si falla, intentar con 2Captcha
    if (!solution) {
        console.log('   🔄 Intentando con servicio alternativo...');
        solution = await solveCaptcha2Captcha(siteKey, pageUrl);
    }

    return solution;
};

const solveCaptchaAntiCaptcha = async (siteKey: string, pageUrl: string): Promise<string | null> => {
    try {
        console.log('   🤖 Intentando resolver con AntiCaptcha...');
        ac.setAPIKey('db461defb372b85e62ca7dee7660292b');
        ac.setSoftId(0);
        ac.shutUp();

        const token = await ac.solveTurnstileProxyless(pageUrl, siteKey);
        console.log('   ✅ AntiCaptcha resolvió el captcha');
        return token;
    } catch (err: any) {
        console.log('   ⚠️  AntiCaptcha falló:', err.message);
        return null;
    }
}

/**
 * Resuelve captcha Turnstile usando 2Captcha
 */
const solveCaptcha2Captcha = async (siteKey: string, pageUrl: string): Promise<string | null> => {
    const apiKey = process.env.CAPTCHA_API_KEY || 'b71c1a124fc456f883fcda82660e0848';
    const endpoint = "https://2captcha.com/in.php";
    const resultEndpoint = "https://2captcha.com/res.php";

    const requestParams = new URLSearchParams({
        key: apiKey,
        method: 'turnstile',
        sitekey: siteKey,
        pageurl: pageUrl,
        json: '1',
    });

    try {
        console.log('   🤖 Intentando resolver con 2Captcha...');
        const response = await axios.post(endpoint, requestParams);
        const requestResult = response.data;

        if (requestResult.status !== 1) {
            console.log('   ⚠️  2Captcha request falló:', requestResult.request);
            return null;
        }

        const captchaId = requestResult.request;
        console.log('   ⏳ Esperando solución del captcha (ID:', captchaId, ')...');

        let solution: string | null = null;
        let attempts = 0;

        while (attempts < 15) {
            const resultParams = new URLSearchParams({
                key: apiKey,
                action: 'get',
                id: captchaId,
                json: '1',
            });

            try {
                const resultResponse = await axios.post(resultEndpoint, resultParams);
                const resultData = resultResponse.data;

                if (resultData.status === 1) {
                    solution = resultData.request;
                    console.log('   ✅ 2Captcha resolvió el captcha');
                    break;
                }

                attempts++;
                console.log(`   ⏳ Intento ${attempts}/15...`);
                await new Promise(resolve => setTimeout(resolve, 7000));
            } catch (resultError: any) {
                console.log('   ⚠️  Error obteniendo resultado:', resultError.message);
                break;
            }
        }

        if (!solution) {
            console.log('   ❌ 2Captcha: Tiempo agotado esperando solución');
        }

        return solution;
    } catch (error: any) {
        console.log('   ⚠️  2Captcha error:', error.message);
        return null;
    }
};


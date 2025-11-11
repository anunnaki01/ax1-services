import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import * as fs from 'fs';
import * as path from 'path';
import * as forge from 'node-forge';
import { resolveCaptcha } from '../infrastructure/utils/captcha';
import { Payload } from '../domain/dian/interfaces';

// Detectar si estamos en Lambda
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

// Importar @sparticuz/chromium solo si estamos en Lambda (usando require)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chromiumPkg = isLambda ? require('@sparticuz/chromium') : null;

// ============================================
// INTERFACES Y TIPOS
// ============================================

interface DianConfig {
    url: string;
    headless: boolean;
}

interface PageInfo {
    title: string;
    url: string;
    bodyText: string;
    formElements: number;
    hasTurnstile: boolean;
    hasIdentificationTypeField: boolean;
    hasUserCodeField: boolean;
    hasCompanyCodeField: boolean;
}

interface AfterLoginInfo {
    title: string;
    url: string;
    bodyText: string;
}

interface CaptchaInfo {
    exists: boolean;
    siteKey: string;
}

interface HandleResult {
    success: boolean;
    certificateAccepted?: boolean;
    formFilled?: boolean;
    pageInfo?: PageInfo;
    screenshots?: {
        beforeSubmit?: string;  // base64
        final?: string;         // base64
    };
    cookies?: Array<{
        name: string;
        value: string;
        domain: string;
        path: string;
        expires?: number;
        httpOnly?: boolean;
        secure?: boolean;
        sameSite?: string;
    }>;
    error?: string;
}

// ============================================
// FUNCIÓN PRINCIPAL
// ============================================

export async function handle(payload: Payload): Promise<HandleResult> {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    const screenshots: { beforeSubmit?: string; final?: string } = {};

    try {
        console.log('=== Prueba de acceso a DIAN con Playwright ===\n');

        // ============================================
        // CONFIGURACIÓN
        // ============================================
        const CONFIG: DianConfig = {
            url: 'https://certificate-vpfe.dian.gov.co/User/CertificateLogin',
            headless: payload.headless ?? false,
        };

        // ============================================
        // PASO 1: Decodificar certificado P12 desde base64
        // ============================================
        console.log('\n--- Decodificando certificado P12 desde base64 ---');

        const p12Buffer = Buffer.from(payload.base64CertificateP12, 'base64');
        console.log('✓ Certificado P12 decodificado desde base64');

        // ============================================
        // PASO 2: Convertir P12 a PEM usando node-forge
        // ============================================
        console.log('\n--- Convirtiendo certificado P12 a PEM ---');

        // Crear carpeta temporal
        const tempDir = '/tmp/playwright-certs';
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const certPath = path.join(tempDir, 'cert.pem');
        const keyPath = path.join(tempDir, 'key.pem');

        try {
            // Convertir el buffer a formato que forge pueda leer
            const p12Der = forge.util.encode64(p12Buffer.toString('binary'));
            const p12Asn1 = forge.asn1.fromDer(forge.util.decode64(p12Der));
            const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, payload.certificatePassword);

            // Extraer los bags de certificados y llaves
            const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
            const pkeyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });

            // Obtener el primer certificado
            const certBag = certBags[forge.pki.oids.certBag]?.[0];
            if (!certBag || !certBag.cert) {
                throw new Error('No se encontró un certificado en el archivo P12');
            }

            // Obtener la primera llave privada
            const keyBag = pkeyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
            if (!keyBag || !keyBag.key) {
                throw new Error('No se encontró una llave privada en el archivo P12');
            }

            // Convertir a PEM
            const certPem = forge.pki.certificateToPem(certBag.cert);
            const keyPem = forge.pki.privateKeyToPem(keyBag.key);

            // Guardar archivos PEM
            fs.writeFileSync(certPath, certPem);
            fs.writeFileSync(keyPath, keyPem);

            console.log('✓ Certificado extraído a PEM:', certPath);
            console.log('✓ Clave privada extraída a PEM:', keyPath);

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new Error(`No se pudo convertir P12 a PEM: ${errorMessage}`);
        }

        // ============================================
        // PASO 3: Lanzar navegador
        // ============================================
        console.log('\n--- Lanzando navegador con Playwright ---');

        // Configuración específica para Lambda o desarrollo local
        let launchOptions;
        
        console.log('DEBUG - isLambda:', isLambda);
        console.log('DEBUG - AWS_LAMBDA_FUNCTION_NAME:', process.env.AWS_LAMBDA_FUNCTION_NAME);
        console.log('DEBUG - chromiumPkg:', typeof chromiumPkg, chromiumPkg ? 'exists' : 'undefined');
        console.log('DEBUG - chromiumPkg.args:', chromiumPkg?.args ? 'exists' : 'undefined');
        
        if (isLambda) {
            launchOptions = {
                args: chromiumPkg.args,
                executablePath: await chromiumPkg.executablePath(),
                headless: true, // Siempre headless en Lambda
            };
        } else {
            launchOptions = {
                headless: CONFIG.headless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                ]
            };
        }

        console.log('Entorno:', isLambda ? 'AWS Lambda' : 'Local');
        browser = await chromium.launch(launchOptions);

        console.log('✓ Navegador iniciado');

        // ============================================
        // PASO 4: Crear contexto con certificado de cliente
        // ============================================
        console.log('\n--- Configurando certificado de cliente ---');

        // Playwright necesita cert y key por separado
        const absoluteCertPath = path.resolve(certPath);
        const absoluteKeyPath = path.resolve(keyPath);

        context = await browser.newContext({
            clientCertificates: [{
                origin: 'https://certificate-vpfe.dian.gov.co',
                certPath: absoluteCertPath,
                keyPath: absoluteKeyPath,
            }, {
                origin: 'https://catalogo-vpfe.dian.gov.co',
                certPath: absoluteCertPath,
                keyPath: absoluteKeyPath,
            }, {
                origin: 'https://vpfe.dian.gov.co',
                certPath: absoluteCertPath,
                keyPath: absoluteKeyPath,
            }],
            ignoreHTTPSErrors: true,
            locale: 'es-CO',
            viewport: { width: 1920, height: 1080 }
        });

        console.log('✅ Certificado configurado con archivos PEM separados');
        console.log('   - Cert:', absoluteCertPath);
        console.log('   - Key:', absoluteKeyPath);
        console.log('✅ NO se mostrará el diálogo de selección');

        const page: Page = await context.newPage();

        // ============================================
        // PASO 5: Navegar al sitio
        // ============================================
        console.log('\n--- Navegando al sitio de la DIAN ---');
        console.log(`URL: ${CONFIG.url}`);
        console.log('\n💡 Con Playwright, el certificado se envía AUTOMÁTICAMENTE\n');

        const startTime = Date.now();

        try {
            await page.goto(CONFIG.url, {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log('⚠️  Error en navegación inicial:', errorMessage);
        }

        // ============================================
        // PASO 6: Detectar y sortear página "No es seguro"
        // ============================================
        console.log('\n--- Verificando advertencias de seguridad ---');

        await page.waitForTimeout(2000); // Esperar a que cargue

        const pageContent = await page.content();
        const currentUrl = page.url();

        // Detectar si estamos en una página de advertencia
        const isWarningPage =
            pageContent.includes('Your connection is not private') ||
            pageContent.includes('No es seguro') ||
            pageContent.includes('NET::ERR_CERT') ||
            pageContent.includes('Advanced') ||
            pageContent.includes('Avanzado') ||
            currentUrl.includes('chrome-error://');

        if (isWarningPage) {
            console.log('⚠️  Página de advertencia detectada');
            console.log('🔄 Intentando sortear la advertencia...');

            try {
                // Buscar y hacer clic en el botón "Advanced" o "Avanzado"
                const advancedButton = await page.$('button#details-button, button[id*="details"], a#details-button').catch(() => null);

                if (advancedButton) {
                    await advancedButton.click();
                    console.log('   ✓ Click en "Avanzado"');
                    await page.waitForTimeout(1000);

                    // Buscar y hacer clic en "Proceed" o "Continuar"
                    const proceedLink = await page.$('a#proceed-link, a[id*="proceed"], button[id*="proceed"]').catch(() => null);

                    if (proceedLink) {
                        await proceedLink.click();
                        console.log('   ✓ Click en "Continuar de todos modos"');
                        await page.waitForTimeout(2000);
                    }
                } else {
                    // Intentar con teclas si no encuentra botones
                    console.log('   ⚠️  No se encontraron botones, intentando con teclas...');
                    await page.keyboard.press('Tab');
                    await page.waitForTimeout(200);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(1000);
                    await page.keyboard.press('Tab');
                    await page.waitForTimeout(200);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(2000);
                }

                console.log('✓ Advertencia sorteada');
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.log('⚠️  No se pudo sortear automáticamente:', errorMessage);
                console.log('   Puedes hacerlo manualmente si el navegador está visible');
            }
        } else {
            console.log('✓ No hay advertencias de seguridad');
        }

        // Esperar a que la página cargue completamente
        try {
            await page.waitForLoadState('networkidle', { timeout: 30000 });
        } catch (error) {
            console.log('⚠️  Timeout esperando networkidle');
        }

        const loadTime = Date.now() - startTime;
        console.log(`✓ Página procesada en ${loadTime}ms`);

        // ============================================
        // PASO 7: Analizar la página
        // ============================================
        console.log('\n--- Analizando página ---');

        const pageInfo: PageInfo = await page.evaluate(() => {
            return {
                title: document.title,
                url: window.location.href,
                bodyText: document.body.innerText.substring(0, 500),
                formElements: document.querySelectorAll('form').length,
                hasTurnstile: document.querySelector('.cf-turnstile') !== null,
                hasIdentificationTypeField: !!document.querySelector('#CompanyIdentificationType'),
                hasUserCodeField: !!document.querySelector('#UserCode'),
                hasCompanyCodeField: !!document.querySelector('#CompanyCode')
            };
        });

        console.log('Título:', pageInfo.title);
        console.log('URL actual:', pageInfo.url);
        console.log('Tiene Turnstile (captcha):', pageInfo.hasTurnstile);
        console.log('Formularios encontrados:', pageInfo.formElements);

        // Verificar si llegamos al formulario de autenticación
        const hasLoginForm =
            pageInfo.hasIdentificationTypeField &&
            pageInfo.hasUserCodeField;

        if (hasLoginForm) {
            console.log('✅ Formulario de autenticación detectado');
            console.log('✅ El certificado fue aceptado - ahora en formulario de datos');

            // ============================================
            // PASO 8: Llenar formulario automáticamente
            // ============================================
            console.log('\n--- Llenando formulario automáticamente ---');

            try {
                // Seleccionar tipo de identificación
                console.log(`Seleccionando tipo de identificación: ${payload.identificationType}`);
                await page.selectOption('#CompanyIdentificationType', payload.identificationType);
                console.log('✓ Tipo de identificación seleccionado');

                await page.waitForTimeout(500);

                // Llenar NIT del representante legal
                console.log(`Ingresando NIT representante legal: ${payload.nitRepresentanteLegal}`);
                await page.fill('#UserCode', payload.nitRepresentanteLegal);
                console.log('✓ NIT representante legal ingresado');

                await page.waitForTimeout(500);

                // Verificar NIT de empresa (readonly)
                const companyCode = await page.inputValue('#CompanyCode');
                console.log(`✓ NIT de empresa detectado: ${companyCode}`);

                // ============================================
                // Detectar y resolver Captcha Turnstile
                // ============================================
                console.log('\n--- Verificando Captcha ---');

                const hasCaptcha: CaptchaInfo = await page.evaluate(() => {
                    const turnstileElement = document.querySelector('.cf-turnstile');
                    if (turnstileElement) {
                        return {
                            exists: true,
                            siteKey: turnstileElement.getAttribute('data-sitekey') || ''
                        };
                    }
                    return { exists: false, siteKey: '' };
                });

                let captchaSolved = false;

                if (hasCaptcha.exists && hasCaptcha.siteKey) {
                    console.log('✓ Captcha Turnstile detectado');

                    const currentUrl = page.url();
                    const captchaSolution = await resolveCaptcha(hasCaptcha.siteKey, currentUrl);

                    if (captchaSolution) {
                        console.log('\n💉 Inyectando solución del captcha en el formulario...');

                        // Inyectar el token del captcha
                        await page.evaluate((solution: string) => {
                            const captchaField = document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement | null;
                            if (captchaField) {
                                captchaField.value = solution;
                            }
                        }, captchaSolution);

                        console.log('✅ Solución del captcha inyectada');
                        captchaSolved = true;

                        // Esperar un momento para asegurar que se procesó
                        await page.waitForTimeout(1000);
                    } else {
                        console.log('❌ No se pudo resolver el captcha automáticamente');
                        console.log('⏳ Esperando 10 segundos para resolución manual...');
                        await page.waitForTimeout(10000);
                    }
                } else {
                    console.log('✓ No hay captcha en esta página');
                    captchaSolved = true; // No hay captcha, podemos continuar
                }

                // Tomar screenshot antes de enviar
                console.log('\n📸 Capturando screenshot antes de enviar...');
                const beforeSubmitBuffer = await page.screenshot();
                screenshots.beforeSubmit = beforeSubmitBuffer.toString('base64');
                console.log('✓ Screenshot capturado en memoria (base64)');

                // Hacer clic en el botón "Entrar"
                if (captchaSolved || !hasCaptcha.exists) {
                    console.log('\n🚀 Enviando formulario...');
                    await page.click('button.btn-primary');
                    console.log('✓ Formulario enviado');
                } else {
                    console.log('\n⚠️  No se enviará el formulario porque el captcha no fue resuelto');
                    console.log('   El navegador permanecerá abierto para inspección manual');
                }

                // Esperar a que cargue la siguiente página
                await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
                    console.log('⏱️ Timeout esperando respuesta del servidor');
                });

                // Esperar un momento adicional
                await page.waitForTimeout(3000);

                // Analizar resultado después del login
                const afterLoginInfo: AfterLoginInfo = await page.evaluate(() => ({
                    title: document.title,
                    url: window.location.href,
                    bodyText: document.body.innerText.substring(0, 500)
                }));

                console.log('\n--- Resultado después del login ---');
                console.log('URL:', afterLoginInfo.url);
                console.log('Título:', afterLoginInfo.title);

                // Verificar si el login fue exitoso
                const loginSuccess =
                    afterLoginInfo.url.includes('Dashboard') ||
                    afterLoginInfo.url.includes('Home') ||
                    afterLoginInfo.bodyText.includes('Bienvenido') ||
                    afterLoginInfo.bodyText.includes('Menú Principal') ||
                    !afterLoginInfo.url.includes('Login');

                if (loginSuccess) {
                    console.log('✅ ¡LOGIN EXITOSO! Has ingresado al sistema');
                } else if (afterLoginInfo.bodyText.includes('captcha') || afterLoginInfo.bodyText.includes('Turnstile')) {
                    console.log('⚠️  Captcha no resuelto. Puede que necesites resolverlo manualmente');
                } else if (afterLoginInfo.bodyText.includes('incorrecto') || afterLoginInfo.bodyText.includes('inválido')) {
                    console.log('❌ Error en los datos ingresados');
                } else {
                    console.log('⚠️  Estado desconocido. Revisa el screenshot');
                }

            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.log('❌ Error llenando el formulario:', errorMessage);
            }

        } else {
            console.log('⚠️  No se detectó el formulario de autenticación');
            console.log('   Posibles causas:');
            console.log('   - El certificado no fue aceptado');
            console.log('   - La página no cargó correctamente');
            console.log('   - Revisa el screenshot para más detalles');
        }

        // ============================================
        // PASO 9: Tomar screenshot final
        // ============================================
        console.log('\n📸 Capturando screenshot final...');
        const finalBuffer = await page.screenshot({ fullPage: true });
        screenshots.final = finalBuffer.toString('base64');
        console.log('✓ Screenshot final capturado en memoria (base64)');

        // ============================================
        // PASO 10: Capturar cookies
        // ============================================
        console.log('\n🍪 Capturando cookies...');
        const cookies = await context.cookies();
        console.log(`✓ ${cookies.length} cookies capturadas`);
        
        // Log de las cookies para debugging
        cookies.forEach(cookie => {
            console.log(`   - ${cookie.name}: ${cookie.value.substring(0, 50)}${cookie.value.length > 50 ? '...' : ''}`);
        });

        // ============================================
        // PASO 11: Esperar para inspección (si no es headless)
        // ============================================
        if (!CONFIG.headless) {
            console.log('\n👀 El navegador permanecerá abierto por 60 segundos...');
            console.log('   Presiona Ctrl+C para cerrar antes');
            await new Promise(resolve => setTimeout(resolve, 60000));
        }

        return {
            success: true,
            certificateAccepted: hasLoginForm,
            formFilled: hasLoginForm,
            pageInfo: pageInfo,
            screenshots: screenshots,
            cookies: cookies
        };

    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        
        console.error('\n❌ Error:', errorMessage);
        if (errorStack) {
            console.error(errorStack);
        }

        return {
            success: false,
            error: errorMessage
        };

    } finally {
        // Limpiar
        if (context) {
            await context.close();
        }
        if (browser) {
            await browser.close();
            console.log('\n✓ Navegador cerrado');
        }
    }
}
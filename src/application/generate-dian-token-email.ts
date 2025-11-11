import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import { resolveCaptcha } from '../infrastructure/utils/captcha';
import type { DianTokenEmailPayload, DianTokenEmailResult } from '../domain/dian/interfaces';

const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chromiumPkg = isLambda ? require('@sparticuz/chromium') : null;

interface ModalGuardState {
    lastError: string | null;
    blockedRedirects: Array<{ fn: string; ts: number; args: unknown[] }>;
}

declare global {
    interface Window {
        __dianModalState?: ModalGuardState;
    }
}

const CONFIG = {
    url: 'https://catalogo-vpfe.dian.gov.co/User/CompanyLogin',
    selectors: {
        legalRepresentativeButton: '#legalRepresentative',
        form: '#form0',
        identificationType: '#CompanyIdentificationType',
        userCode: '#UserCode',
        companyCode: '#CompanyCode',
        captchaContainer: '.cf-turnstile',
        captchaResponseInput: 'input[name="cf-turnstile-response"]',
        submitButton: '#form0 button.btn.btn-primary',
        errorModal: '#errorModal',
        errorModalTitle: '#errorModal-title',
        errorModalMessage: '#errorModal-message',
        successAlert: '.dian-alert-info p',
        errorAlert: '.dian-alert-danger p',
        toastMessage: '.toast-message'
    },
    timeouts: {
        default: 60000,
        captcha: 90000,
        result: 60000,
    },
    waitTimes: {
        afterCaptcha: 1000
    }
} as const;

export async function handle(payload: DianTokenEmailPayload): Promise<DianTokenEmailResult> {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
        validatePayload(payload);

        console.log('=== Generar token DIAN por correo (Playwright) ===');
        console.log('Origen:', payload.origin ?? 'no especificado');

        const headless = payload.headless ?? (isLambda ? true : false);

        browser = await initializeBrowser(headless);
        context = await browser.newContext();
        page = await context.newPage();
        await setupModalGuards(page);

        await page.goto(CONFIG.url, {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });
        await waitForModalGuardReady(page);

        await interactWithLoginForm(page, payload);

        const message = await waitForResultMessage(page);

        console.log('Resultado exitoso:', message);

        return {
            success: true,
            message,
            origin: payload.origin
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Error generando token DIAN:', errorMessage);

        let screenshot: string | undefined;

        if (page && !isLambda) {
            try {
                const buffer = await page.screenshot({ fullPage: true });
                screenshot = buffer.toString('base64');
                console.log('📸 Screenshot capturado para debugging.');
            } catch (screenshotError) {
                console.warn('⚠️ No se pudo capturar screenshot:', screenshotError);
            }
        }

        const errorResponse: DianTokenEmailResult = {
            success: false,
            error: errorMessage,
            origin: payload.origin
        };

        if (!isLambda && screenshot) {
            errorResponse.screenshot = screenshot;
        }

        return errorResponse;
    } finally {
        if (page) {
            await page.close().catch(err => console.warn('⚠️ Error cerrando la página:', err));
        }
        if (context) {
            await context.close().catch(err => console.warn('⚠️ Error cerrando el contexto:', err));
        }
        if (browser) {
            await browser.close().catch(err => console.warn('⚠️ Error cerrando el navegador:', err));
        }
    }
}

function validatePayload(payload: DianTokenEmailPayload): void {
    const missingFields: string[] = [];

    if (!payload.identificationType) missingFields.push('identificationType');
    if (!payload.userCode) missingFields.push('userCode');
    if (!payload.companyCode) missingFields.push('companyCode');

    if (missingFields.length) {
        throw new Error(`Campos obligatorios faltantes: ${missingFields.join(', ')}`);
    }
}

async function initializeBrowser(headless: boolean): Promise<Browser> {
    const baseArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920x1080',
        '--single-process',
        '--no-zygote',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-ipc-flooding-protection',
        '--disable-hang-monitor',
        '--disable-prompt-on-repost',
        '--disable-sync',
        '--disable-domain-reliability',
        '--metrics-recording-only',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
        '--disable-client-side-phishing-detection',
        '--disable-default-apps',
        '--mute-audio',
        '--hide-scrollbars',
        '--disable-background-networking',
        '--disk-cache-size=0'
    ];

    if (isLambda) {
        console.log('Ejecutando en entorno AWS Lambda');
        return chromium.launch({
            args: chromiumPkg.args.concat(baseArgs),
            executablePath: await chromiumPkg.executablePath(),
            headless: true,
        });
    }

    console.log('Ejecutando en entorno local');
    return chromium.launch({
        headless,
        args: baseArgs,
    });
}

async function setupModalGuards(page: Page): Promise<void> {
    await page.addInitScript(({ selectors }) => {
        const globalWindow = window as unknown as {
            __dianModalState?: {
                lastError: string | null;
                blockedRedirects: Array<{ fn: string; ts: number; args: unknown[] }>;
            };
        };

        if (globalWindow.__dianModalState) {
            return;
        }

        const selectorsCopy = selectors;
        const STORAGE_KEY = '__dianModalError';

        const setup = (): void => {
            const state = {
                lastError: null as string | null,
                blockedRedirects: [] as Array<{ fn: string; ts: number; args: unknown[] }>
            };

            globalWindow.__dianModalState = state;

            const stored = sessionStorage.getItem(STORAGE_KEY);
            if (stored) {
                state.lastError = stored;
            }

            const isModalVisible = (): boolean => {
                const modal = document.querySelector<HTMLElement>(selectorsCopy.errorModal);
                if (!modal) return false;
                const style = window.getComputedStyle(modal);
                const ariaHidden = modal.getAttribute('aria-hidden');
                const hasInClass = modal.classList.contains('in');
                return (style.display !== 'none' || hasInClass) && ariaHidden !== 'true';
            };

            const captureModal = (): void => {
                if (!isModalVisible()) {
                    return;
                }
                const title = document.querySelector<HTMLElement>(selectorsCopy.errorModalTitle)?.textContent?.trim() ?? '';
                const message = document.querySelector<HTMLElement>(selectorsCopy.errorModalMessage)?.textContent?.trim() ?? '';
                const text = [title, message].filter(Boolean).join(' - ') || 'Se presentó un error en el portal de la DIAN.';
                state.lastError = text;
                sessionStorage.setItem(STORAGE_KEY, text);
            };

            const observer = new MutationObserver(() => {
                captureModal();
            });

            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class', 'aria-hidden']
            });

            captureModal();

            const wrapNavigation = <Args extends unknown[]>(fn: (...args: Args) => unknown, fnName: string) => {
                return (...args: Args): unknown => {
                    captureModal();
                    if (isModalVisible()) {
                        state.blockedRedirects.push({ fn: fnName, ts: Date.now(), args });
                        console.warn(`[DIAN][ModalGuard] Bloqueo de navegación (${fnName}).`);
                        return undefined;
                    }
                    return fn.apply(window.location, args);
                };
            };

            const originalAssign = window.location.assign.bind(window.location);
            const originalReplace = window.location.replace.bind(window.location);
            const originalReload = window.location.reload.bind(window.location);

            window.location.assign = wrapNavigation(originalAssign, 'assign') as typeof window.location.assign;
            window.location.replace = wrapNavigation(originalReplace, 'replace') as typeof window.location.replace;
            window.location.reload = wrapNavigation(originalReload, 'reload') as typeof window.location.reload;
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setup, { once: true });
        } else {
            setup();
        }
    }, { selectors: CONFIG.selectors });
}

async function getModalState(page: Page): Promise<ModalGuardState | null> {
    try {
        return await page.evaluate(() => {
            return window.__dianModalState ?? null;
        });
    } catch (error) {
        console.warn('No fue posible obtener el estado del modal:', error);
        return null;
    }
}

async function consumeStoredModalError(page: Page): Promise<string | null> {
    try {
        return await page.evaluate(() => {
            const key = '__dianModalError';
            const value = sessionStorage.getItem(key);
            if (value) {
                sessionStorage.removeItem(key);
            }
            return value;
        });
    } catch (error) {
        console.warn('No fue posible leer el error persistido del modal:', error);
        return null;
    }
}

async function waitForModalGuardReady(page: Page): Promise<void> {
    try {
        await page.waitForFunction(() => typeof window.__dianModalState !== 'undefined', {});
    } catch (error) {
        console.warn('El guard de modal no se inicializó a tiempo:', error);
    }
}

async function interactWithLoginForm(page: Page, payload: DianTokenEmailPayload): Promise<void> {

    const legalRepresentativeButton = page.locator(CONFIG.selectors.legalRepresentativeButton);
    await legalRepresentativeButton.waitFor({ state: 'visible' });
    await page.waitForTimeout(5000);
    
    try {
        await legalRepresentativeButton.click({ timeout: 10000 });
    } catch (error) {
        console.warn('⚠️  Falló el click en legalRepresentative, reintentando con force...');
        await legalRepresentativeButton.click({ force: true });
    }

    await page.waitForTimeout(2000);

    console.log('Esperando formulario...');
    await page.waitForSelector(CONFIG.selectors.form, { state: 'visible' });

    console.log('Llenando campos del formulario...');
    await page.selectOption(CONFIG.selectors.identificationType, String(payload.identificationType));
    await page.fill(CONFIG.selectors.userCode, String(payload.userCode));
    await page.fill(CONFIG.selectors.companyCode, String(payload.companyCode));

    console.log('Resolviendo captcha Turnstile...');
    const captchaSolution = await solveTurnstileCaptcha(page);

    if (!captchaSolution) {
        throw new Error('No se pudo resolver el captcha Turnstile');
    }

    console.log('Captcha resuelto. Enviando formulario...');
    await page.waitForTimeout(CONFIG.waitTimes.afterCaptcha);
    const submitButton = page.locator(CONFIG.selectors.submitButton);

    try {
        await submitButton.click({ timeout: 5000 });
    } catch (error) {
        console.warn('⚠️  Falló el click en submit, reintentando con force...');
        await submitButton.click({ force: true });
    }
}

async function solveTurnstileCaptcha(page: Page): Promise<string | null> {
    await page.waitForSelector(CONFIG.selectors.captchaContainer, { state: 'visible', timeout: CONFIG.timeouts.captcha });

    const siteKey = await page.getAttribute(CONFIG.selectors.captchaContainer, 'data-sitekey');

    if (!siteKey) {
        throw new Error('No se pudo obtener el sitekey del captcha');
    }

    const token = await resolveCaptcha(siteKey, page.url());

    if (!token) {
        return null;
    }

    await page.waitForSelector(CONFIG.selectors.captchaResponseInput, { state: 'attached' });
    await page.evaluate(({ selector, solution }: { selector: string; solution: string }) => {
        const field = document.querySelector<HTMLInputElement>(selector);
        if (field) {
            field.value = solution;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }, { selector: CONFIG.selectors.captchaResponseInput, solution: token });

    return token;
}

async function waitForResultMessage(page: Page): Promise<string> {
    const deadline = Date.now() + CONFIG.timeouts.result;
    let lastModalError: string | null = null;
    let lastBlockedRedirects = 0;

    while (Date.now() < deadline) {
        const storedModalError = await consumeStoredModalError(page);
        if (storedModalError) {
            lastModalError = storedModalError;
            throw new Error(storedModalError);
        }

        const modalState = await getModalState(page);
        if (modalState?.lastError) {
            lastModalError = modalState.lastError;
            throw new Error(modalState.lastError);
        }

        if (modalState?.blockedRedirects?.length) {
            if (modalState.blockedRedirects.length !== lastBlockedRedirects) {
                console.warn('[DIAN][ModalGuard] Navegación bloqueada por modal:', JSON.stringify(modalState.blockedRedirects, null, 2));
                lastBlockedRedirects = modalState.blockedRedirects.length;
            }
        }

        const modalError = await readModalError(page);
        if (modalError) {
            lastModalError = modalError;
            throw new Error(modalError);
        }

        try {
            const successElement = await page.$(CONFIG.selectors.successAlert);
            if (successElement) {
                const message = (await successElement.innerText().catch(() => ''))?.trim();
                if (message) {
                    return message;
                }
            }
        } catch (error) {
            console.warn('No fue posible leer el mensaje de éxito.', error);
        }

        try {
            const extractedError = await extractErrorMessage(page);
            if (extractedError) {
                throw new Error(extractedError);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('Target page, context or browser has been closed')) {
                throw new Error(lastModalError ?? 'La página de la DIAN se recargó antes de obtener respuesta. Verifique el estado del portal e intente nuevamente.');
            }
            console.warn('No fue posible leer los mensajes de error.', error);
        }

        if (modalState?.lastError && !lastModalError) {
            lastModalError = modalState.lastError;
        }

        if (page.isClosed()) {
            throw new Error(lastModalError ?? 'La página de la DIAN se cerró antes de obtener respuesta. Verifique los datos e intente nuevamente.');
        }

        try {
            const selectionButton = await page.$(CONFIG.selectors.legalRepresentativeButton);
            if (selectionButton) {
                const returnedToSelection = await selectionButton.evaluate((el: Element) => {
                    const style = window.getComputedStyle(el as HTMLElement);
                    return style.display !== 'none' && style.visibility !== 'hidden';
                }).catch(() => false);

                if (returnedToSelection) {
                    if (lastModalError) {
                        throw new Error(lastModalError);
                    }

                    const fallbackModal = await readModalError(page);
                    if (fallbackModal) {
                        throw new Error(fallbackModal);
                    }

                    throw new Error('No fue posible generar el token. Verifique la información e intente nuevamente.');
                }
            }
        } catch (error) {
            console.warn('No fue posible verificar el estado del formulario inicial.', error);
        }

        await page.waitForTimeout(100);
    }

    throw new Error(lastModalError ?? 'No se recibió confirmación del envío del correo. Verifique las credenciales.');
}

async function readModalError(page: Page): Promise<string | null> {
    try {
        const modalHandle = await page.$(CONFIG.selectors.errorModal);
        if (!modalHandle) {
            return null;
        }

        const isVisible = await modalHandle.evaluate((modal: Element) => {
            const style = window.getComputedStyle(modal as HTMLElement);
            const ariaHidden = modal.getAttribute('aria-hidden');
            const hasInClass = modal.classList.contains('in');
            return (style.display !== 'none' || hasInClass) && ariaHidden !== 'true';
        }).catch(() => false);

        if (!isVisible) {
            return null;
        }

        const title = await page.$eval(
            CONFIG.selectors.errorModalTitle,
            (element) => element.textContent?.trim() ?? ''
        ).catch(() => '');

        const message = await page.$eval(
            CONFIG.selectors.errorModalMessage,
            (element) => element.textContent?.trim() ?? ''
        ).catch(() => '');

        const text = [title, message].filter(Boolean).join(' - ');
        return text || 'Se presentó un error en el portal de la DIAN.';
    } catch (error) {
        return null;
    }
}

async function extractErrorMessage(page: Page): Promise<string | null> {
    const selectorsToCheck = [
        CONFIG.selectors.errorAlert,
        CONFIG.selectors.toastMessage
    ];

    for (const selector of selectorsToCheck) {
        const element = await page.$(selector);
        if (element) {
            const text = (await element.innerText())?.trim();
            if (text) {
                return text;
            }
        }
    }

    // Último intento: revisar si hay texto visible en la página que indique error
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    if (bodyText.includes('credenciales') || bodyText.includes('incorrect')) {
        return 'Verifique las credenciales de inicio de sesión.';
    }

    return null;
}

/**
 * Lambda para consultar información empresarial en el RUES (Registro Único Empresarial y Social de Colombia)
 * Uso de playwright-core en lugar de puppeteer para compatibilidad con AWS Lambda
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright-core';
import { RuesPayload, RuesResult, RuesData } from '../domain/rues/interfaces';
import { getNextProxy } from '../config/proxies';

// Detectar si estamos en Lambda
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

// Importar @sparticuz/chromium solo si estamos en Lambda
// eslint-disable-next-line @typescript-eslint/no-var-requires
const chromiumPkg = isLambda ? require('@sparticuz/chromium') : null;

// ============================================
// CONFIGURACIÓN
// ============================================

const CONFIG = {
    url: 'https://www.rues.org.co/',
    recordTypes: [
        "RM", // "Registro Mercantil",
        "ESAL", //"Entidades sin animo de lucro",
        "ESOL", //"Registro de entidades de economia solidaria",
    ],
    mapRecords: {
        RM: "Registro Mercantil",
        ESAL: "Entidades sin animo de lucro",
        ESOL: "Registro de entidades de economia solidaria",
    },
    selectors: {
        typeSelector: '.select-type-index',
        idInput: 'input[name="search"]',
        submitButton: 'button[type="submit"]',
        results: '.card-result',
        noResultsMessage: '.mensaje-alerta',
        resultLink: '.resultado__enlace a',
        tabs: {
            general: '#detail-tabs-tabpane-pestana_general',
            economic: '#detail-tabs-tabpane-pestana_economica',
            representative: '#detail-tabs-tabpane-pestana_representante',
            establishments: '#detail-tabs-tabpane-pestana_establecimientos',
            economicTab: '#detail-tabs-tab-pestana_economica',
            representativeTab: '#detail-tabs-tab-pestana_representante',
            establishmentsTab: '#detail-tabs-tab-pestana_establecimientos'
        }
    },
    maxTries: 3,
    timeouts: {
        defaultTimeout: 120000,
        waitBetweenActions: 1000,
        waitForTab: 10000
    }
};

// ============================================
// FUNCIÓN PRINCIPAL
// ============================================

export async function handle(payload: RuesPayload): Promise<RuesResult> {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
        console.log('=== Consulta RUES con Playwright ===\n');
        console.log('Identificación:', payload.identificationNumber);

        // Validar entrada
        if (!payload.identificationNumber) {
            throw new Error('La identificación es requerida.');
        }

        // Inicializar navegador
        browser = await initializeBrowser(payload.headless ?? true);
        context = await browser.newContext();
        page = await setupPage(context);

        // Buscar por identificación
        const result = await searchByIdentification(page, payload.identificationNumber);

        console.log('✓ Consulta exitosa');

        return {
            success: true,
            data: result
        };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error en consulta RUES:', errorMessage);

        // Relanzar el error para que el handler pueda capturar el errorCode
        throw error;
    } finally {
        if (page) {
            try {
                await page.close();
            } catch (error) {
                console.warn('⚠️  Error cerrando la página:', error);
            }
        }

        if (context) {
            try {
                await context.close();
            } catch (error) {
                console.warn('⚠️  Error cerrando el contexto:', error);
            }
        }

        if (browser) {
            try {
                await browser.close();
            } catch (error) {
                console.warn('⚠️  Error cerrando el navegador:', error);
            }
        }
    }
}

// ============================================
// FUNCIONES AUXILIARES
// ============================================

/**
 * Inicializa el navegador Playwright
 */
async function initializeBrowser(headless: boolean): Promise<Browser> {
    const args = [
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
        '--disk-cache-size=0',
    ];

    // Obtener proxy aleatorio
    //const proxy = getNextProxy();
    
    //if (proxy) {
    //    console.log(`🔄 Usando proxy: ${proxy.server}`);
    //}

    if (isLambda) {
        console.log('Ejecutando en AWS Lambda');
        return chromium.launch({
            args: chromiumPkg.args.concat(args),
            executablePath: await chromiumPkg.executablePath(),
            headless: true,
            //proxy: proxy || undefined,
        });
    } else {
        console.log('Ejecutando en entorno local');
        return chromium.launch({
            headless,
            args,
            //proxy: proxy || undefined,
        });
    }
}

/**
 * Configura la página de Playwright
 */
async function setupPage(context: BrowserContext): Promise<Page> {
    const page = await context.newPage();
    page.setDefaultTimeout(CONFIG.timeouts.defaultTimeout);
    console.log(`⏱️  Timeout configurado: ${CONFIG.timeouts.defaultTimeout / 1000}s`);
    await page.goto(CONFIG.url, { waitUntil: 'networkidle' });
    return page;
}

/**
 * Función auxiliar para esperar
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Busca una entidad por número de identificación
 */
async function searchByIdentification(page: Page, identification: string): Promise<RuesData> {
    let allApisFailed = true;
    
    for (const recordType of CONFIG.recordTypes) {
        console.log(`\n📋 Buscando en: ${CONFIG.mapRecords[recordType as keyof typeof CONFIG.mapRecords]}`);
        
        await closeSweetAlertModal(page);
        await sleep(CONFIG.timeouts.waitBetweenActions);

        // Seleccionar tipo de registro
        await selectRecordType(page, recordType);

        // Ingresar identificación y enviar (retorna true si la API respondió)
        const apiResponded = await enterIdentificationAndSubmit(page, identification);
        
        if (apiResponded) {
            allApisFailed = false;
            
            // Verificar resultados
            const hasResults = await verifyResults(page);

            if (hasResults) {
                console.log('✅ Documento encontrado, extrayendo información...');
                const result = await extractInformation(page);
                return { ...result, tipo_empresa: CONFIG.mapRecords[recordType as keyof typeof CONFIG.mapRecords] };
            } else {
                console.log('ℹ️  No se encontró en este tipo de registro');
            }
        } else {
            console.log('⚠️  La API no respondió para este tipo de registro, continuando...');
        }
    }

    if (allApisFailed) {
        const error = new Error(`No se pudo consultar el documento ${identification}. La API de RUES no está respondiendo. Por favor intente más tarde.`);
        (error as any).code = 'API_ERROR';
        throw error;
    }

    const error = new Error(`Documento ${identification} no encontrado en ningún tipo de registro (RM, ESAL, ESOL).`);
    (error as any).code = 'NOT_FOUND';
    throw error;
}

/**
 * Cierra el modal de SweetAlert si existe
 */
async function closeSweetAlertModal(page: Page): Promise<boolean> {
    try {
        await sleep(CONFIG.timeouts.waitBetweenActions);

        // Verificar si el modal está presente
        const modalExists = await page.locator('.swal2-container.swal2-backdrop-show').count() > 0;

        if (modalExists) {
            // Intentar cerrar con el botón X
            const closeButton = page.locator('.swal2-close');
            if (await closeButton.count() > 0) {
                await closeButton.click();
                await sleep(CONFIG.timeouts.waitBetweenActions);
                return true;
            }

            // Si no hay botón X, presionar Escape
            await page.keyboard.press('Escape');
            await sleep(CONFIG.timeouts.waitBetweenActions);
            return true;
        }

        return false;
    } catch (error) {
        return false;
    }
}

/**
 * Selecciona el tipo de registro en el formulario
 */
async function selectRecordType(page: Page, recordType: string): Promise<void> {
    await page.waitForSelector(CONFIG.selectors.typeSelector);
    const selectElements = page.locator(CONFIG.selectors.typeSelector);
    const count = await selectElements.count();

    if (count === 0) {
        throw new Error('No se encontró ningún elemento select');
    }

    await selectElements.first().selectOption(recordType);
}

/**
 * Ingresa la identificación y envía el formulario
 * Retorna true si la API respondió correctamente (con o sin resultados)
 * Retorna false si hubo timeout o error en la API
 */
async function enterIdentificationAndSubmit(page: Page, identification: string): Promise<boolean> {
    await page.waitForSelector(CONFIG.selectors.idInput);

    // Limpiar el input
    await page.locator(CONFIG.selectors.idInput).fill('');
    
    // Ingresar identificación
    await page.locator(CONFIG.selectors.idInput).fill(identification);

    // Buscar y hacer clic en el botón visible
    const visibleButton = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button[type="submit"].btn-busqueda'));
        for (const button of buttons) {
            const style = window.getComputedStyle(button as Element);
            if (style.display !== 'none') {
                return true;
            }
        }
        return false;
    });

    if (visibleButton) {
        // Hacer clic en el botón de búsqueda
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button[type="submit"].btn-busqueda'));
            for (const button of buttons) {
                const style = window.getComputedStyle(button as Element);
                if (style.display !== 'none') {
                    (button as HTMLElement).click();
                    return;
                }
            }
        });

        console.log('⏳ Esperando que termine la búsqueda (observando spinner del botón)...');
        
        // Esperar a que aparezca el spinner dentro del botón (búsqueda iniciada)
        try {
            await page.waitForFunction(() => {
                const buttons = Array.from(document.querySelectorAll('button[type="submit"].btn-busqueda'));
                for (const button of buttons) {
                    const style = window.getComputedStyle(button as Element);
                    if (style.display !== 'none') {
                        // Buscar el spinner dentro del botón
                        const spinner = button.querySelector('i.spinner-border');
                        return spinner !== null;
                    }
                }
                return false;
            }, { timeout: 3000 });
            console.log('✓ Búsqueda iniciada (spinner visible)');
        } catch (error) {
            console.log('⚠️  No se detectó spinner en el botón (puede ser muy rápido o ya terminó)');
        }
        
        // Ahora esperar a que el spinner desaparezca del botón (búsqueda completada)
        try {
            await page.waitForFunction(() => {
                const buttons = Array.from(document.querySelectorAll('button[type="submit"].btn-busqueda'));
                for (const button of buttons) {
                    const style = window.getComputedStyle(button as Element);
                    if (style.display !== 'none') {
                        // Verificar que NO haya spinner
                        const spinner = button.querySelector('i.spinner-border');
                        return spinner === null;
                    }
                }
                return false;
            }, { timeout: 60000 });
            console.log('✓ Búsqueda completada (spinner desapareció)');
        } catch (error) {
            console.log('❌ Timeout: El spinner no desapareció después de 60s');
            await closeSweetAlertModal(page);
            return false;
        }
        
        // Esperar un poco para que el DOM se actualice con los resultados
        await sleep(2000);
        
        return true;
    }
    
    return false;
}

/**
 * Verifica si hay resultados de búsqueda
 */
async function verifyResults(page: Page): Promise<boolean> {
    try {
        const noResults = await page.evaluate((noResultsSelector) => {
            const messages = Array.from(document.querySelectorAll(noResultsSelector));
            return messages.some((m: Element) => m.textContent?.includes('No se encontraron resultados'));
        }, CONFIG.selectors.noResultsMessage);

        if (noResults) {
            return false;
        }

        const hasResults = await page.evaluate((resultsSelector) => {
            return document.querySelectorAll(resultsSelector).length > 0;
        }, CONFIG.selectors.results);

        return hasResults;
    } catch (error) {
        return false;
    }
}

/**
 * Obtiene el índice de la tarjeta con estado "Activa"
 */
async function getCardStatusActive(page: Page): Promise<number> {
    const cardIndex = await page.evaluate((cardResult) => {
        const cards = Array.from(document.querySelectorAll(cardResult));

        // Buscar card con estado "Activa"
        for (let i = 0; i < cards.length; i++) {
            const spans = Array.from(cards[i].querySelectorAll('span'));
            for (const span of spans) {
                if (span.textContent?.trim() === 'Activa') {
                    return i;
                }
            }
        }

        // Si no se encuentra ninguno activo, retorna el índice del último
        return cards.length > 0 ? cards.length - 1 : -1;
    }, CONFIG.selectors.results);

    if (cardIndex < 0) {
        throw new Error('Card no encontrada');
    }

    return cardIndex;
}

/**
 * Extrae la información de los resultados
 */
async function extractInformation(page: Page): Promise<RuesData> {
    await page.waitForSelector(CONFIG.selectors.results);

    // Extraer información básica de la tarjeta de resultados
    const basicInfo = await extractBasicInfo(page);

    const cardIndex = await getCardStatusActive(page);
    const allCards = page.locator(CONFIG.selectors.results);
    const selectedCard = allCards.nth(cardIndex);
    
    // Usar .first() para obtener solo el primer enlace si hay múltiples
    const href = selectedCard.locator(CONFIG.selectors.resultLink).first();
    await href.click();

    // Esperar a que se carguen todas las pestañas
    await waitForDetailTabs(page);

    // Extraer información detallada
    const details = await extractDetailedInfo(page);

    return {
        nombre: basicInfo.nombre || '',
        tipo_empresa: '',
        ...basicInfo,
        ...details,
    };
}

/**
 * Extrae información básica de la tarjeta de resultados
 */
async function extractBasicInfo(page: Page): Promise<Partial<RuesData>> {
    const cardIndex = await getCardStatusActive(page);

    return page.evaluate((args: { resultsSelector: string; cardIndex: number }) => {
        // Función para normalizar claves
        function normalizeKey(key: string): string {
            return key.toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Eliminar tildes
                .replace(/[^\w\s]/g, '') // Eliminar caracteres especiales
                .replace(/\s+/g, '_') // Reemplazar espacios con guiones bajos
                .replace(/__+/g, '_');
        }

        const result: Record<string, string> = {};
        const cards = Array.from(document.querySelectorAll(args.resultsSelector));

        if (cards.length === 0) {
            throw new Error('No se encontró contenedor de resultados');
        }

        const cardResult = cards[args.cardIndex];

        // Extraer nombre
        const nombreElement = cardResult.querySelector('.filtro__titulo');
        if (nombreElement) {
            result['nombre'] = nombreElement.textContent || '';
        }

        // Extraer otros campos
        const records = Array.from(cardResult.querySelectorAll('.registroapi'));
        records.forEach((record: Element) => {
            const label = record.querySelector('.registroapi__etiqueta');
            const value = record.querySelector('span');

            if (label && value) {
                const key = normalizeKey(label.textContent?.trim() || '');
                result[key] = value.textContent?.trim() || '';
            }
        });

        return result;
    }, { resultsSelector: CONFIG.selectors.results, cardIndex });
}

/**
 * Espera a que la página de detalles se cargue
 */
async function waitForDetailTabs(page: Page): Promise<void> {
    // Solo esperamos la pestaña general que siempre está visible
    // Las otras pestañas (económica, representante, establecimientos) están ocultas
    // y se hacen visibles cuando se hace clic en sus tabs dentro de extractDetailedInfo()
    try {
        await page.waitForSelector(CONFIG.selectors.tabs.general, { timeout: CONFIG.timeouts.waitForTab });
        console.log('✓ Página de detalles cargada');
    } catch (error) {
        console.log('⚠️  Error cargando página de detalles');
        throw new Error('No se pudo cargar la página de detalles');
    }
    
    // Pequeña espera para asegurar que el DOM esté estable
    await sleep(1000);
}

/**
 * Extrae información detallada de todas las pestañas
 */
async function extractDetailedInfo(page: Page): Promise<Partial<RuesData>> {
    type Selectors = typeof CONFIG.selectors;
    
    return page.evaluate(async (args: { selectors: Selectors; maxTries: number }) => {
        const { selectors, maxTries } = args;
        
        // Función para normalizar claves
        function normalizeKey(key: string): string {
            return key.toLowerCase()
                .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Eliminar tildes
                .replace(/[^\w\s]/g, '') // Eliminar caracteres especiales
                .replace(/\s+/g, '_') // Reemplazar espacios con guiones bajos
                .replace(/__+/g, '_');
        }

        /**
         * Obtener información del tab
         */
        function getTabInformation(tab: Element): Record<string, string> {
            const records = Array.from(tab.querySelectorAll('.registroapi'));
            const result: Record<string, string> = {};

            records.forEach((record: Element) => {
                const label = record.querySelector('.registroapi__etiqueta');
                const value = record.querySelector('.registroapi__valor');

                if (label && value) {
                    const key = normalizeKey(label.textContent?.trim() || '');
                    result[key] = value.textContent?.trim() || '';
                }
            });

            return result;
        }

        /**
         * Obtener los códigos CIIU
         */
        async function getEconomicActivity(): Promise<Array<{ ciiu: string; description: string }>> {
            for (let attempt = 1; attempt <= maxTries; attempt++) {
                const tab = document.querySelector(selectors.tabs.economic);
                
                if (!tab) {
                    if (attempt < maxTries) {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        continue;
                    }
                    return [];
                }

                const records = Array.from(tab.querySelectorAll('.registroapi'));

                if (records.length > 0) {
                    const result: Array<{ ciiu: string; description: string }> = [];

                    records.forEach((record: Element) => {
                        const ciiu = record.querySelector('.registroapi__etiqueta');
                        const description = record.querySelector('.registroapi__valor');

                        if (ciiu && description) {
                            result.push({
                                ciiu: ciiu.textContent?.trim() || '',
                                description: description.textContent?.trim() || ''
                            });
                        }
                    });

                    return result.filter(item => item.ciiu !== '');
                }

                if (attempt < maxTries) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }

            return [];
        }

        // 1. Extraer información general
        const tabGeneralInformation = document.querySelector(selectors.tabs.general);
        const generalInfo = tabGeneralInformation ? getTabInformation(tabGeneralInformation) : {};

        // 2. Extraer actividad económica
        const economicTabButton = document.querySelector(selectors.tabs.economicTab);
        if (economicTabButton) {
            (economicTabButton as HTMLElement).click();
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const economicInfo = await getEconomicActivity();

        // 3. Extraer representante legal
        const representativeTabButton = document.querySelector(selectors.tabs.representativeTab);
        if (representativeTabButton) {
            (representativeTabButton as HTMLElement).click();
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        const tabLegalRepresentative = document.querySelector(selectors.tabs.representative);
        const legalRepresentative = tabLegalRepresentative?.querySelector('.legal')?.textContent || '';

        return {
            informacion_general: generalInfo,
            actividad_economica: economicInfo,
            representante_legal: legalRepresentative,
        };
    }, { selectors: CONFIG.selectors, maxTries: CONFIG.maxTries });
}

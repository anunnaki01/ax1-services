#!/usr/bin/env node

/**
 * Script para probar la lambda generate-dian-token-email localmente
 * Uso:
 *   npm run build
 *   node scripts/test-generate-dian-token-email-local.js
 */

const fs = require('fs');
const path = require('path');

async function main() {
    console.log('='.repeat(80));
    console.log('🧪 PRUEBA LOCAL - Lambda generate-dian-token-email');
    console.log('='.repeat(80));
    console.log(`⏰ Fecha: ${new Date().toLocaleString('es-CO')}\n`);

    const eventPath = path.join(__dirname, '../events/dian-token.json');

    if (!fs.existsSync(eventPath)) {
        console.error('❌ No se encontró el archivo events/dian-token.json');
        console.log('Crea el archivo a partir de events/dian-token.json.example si existe.\n');
        process.exit(1);
    }

    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));

    // Permitir override por argumentos CLI
    if (process.argv.includes('--headless=false')) {
        event.headless = false;
    }

    const hasId = Boolean(event.identificationType || event.CompanyIdentificationType);
    const hasUser = Boolean(event.userCode || event.UserCode);
    const hasCompany = Boolean(event.companyCode || event.CompanyCode);

    if (!hasId || !hasUser || !hasCompany) {
        console.error('❌ El payload de prueba debe incluir identificationType, userCode y companyCode.');
        console.log('Contenido actual del evento:\n', JSON.stringify(event, null, 2));
        process.exit(1);
    }

    console.log('📤 Evento enviado a la lambda:');
    console.log(JSON.stringify(event, null, 2));
    console.log('\n' + '-'.repeat(80));

    const handlerPath = path.join(__dirname, '../dist/lambdas/generate-dian-token-email.js');

    if (!fs.existsSync(handlerPath)) {
        console.log('⚠️  Handler no compilado. Ejecutando build...\n');
        const { execSync } = require('child_process');
        execSync('npm run build', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    }

    const { handler } = require(handlerPath);

    const context = {
        functionName: 'test-local-generate-dian-token-email',
        memoryLimitInMB: '1024',
        awsRequestId: `local-${Date.now()}`,
        getRemainingTimeInMillis: () => 900000
    };

    console.log('⚙️  Ejecutando lambda...\n');
    const startTime = Date.now();

    try {
        const result = await handler(event, context);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log('-'.repeat(80));
        console.log(`⏱️  Duración: ${duration} segundos`);
        console.log('-'.repeat(80));

        console.log('\n📥 Respuesta de la lambda:');
        console.log(JSON.stringify(result, null, 2));

        if (result?.body) {
            const body = JSON.parse(result.body);
            if (body.screenshot) {
                const outputDir = path.join(__dirname, '../output');
                fs.mkdirSync(outputDir, { recursive: true });
                const screenshotPath = path.join(outputDir, 'generate-dian-token-email.png');
                fs.writeFileSync(screenshotPath, Buffer.from(body.screenshot, 'base64'));
                console.log(`\n📸 Screenshot guardado en: ${screenshotPath}`);
            }

            if (body.success) {
                console.log('\n✅ ¡Correo solicitado exitosamente!');
            } else {
                console.log('\n❌ La lambda respondió con error:');
                console.log(`   ${body.error || 'Error desconocido'}`);
            }
        }

        console.log('\n' + '='.repeat(80));
    } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('-'.repeat(80));
        console.log(`⏱️  Duración: ${duration} segundos`);
        console.log('-'.repeat(80));
        console.error('\n❌ Error ejecutando la lambda:');
        console.error(error);
        console.log('\n' + '='.repeat(80));
        process.exit(1);
    }
}

main();



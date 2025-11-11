#!/usr/bin/env node

/**
 * Script para probar la lambda localmente sin Serverless
 * Uso: node scripts/test-get-dian-cookie-by-certificate-local.js
 */

const fs = require('fs');
const path = require('path');

// Importar el handler directamente
async function testGetDianCookieByCertificateLocal() {
    console.log('🧪 Probando lambda localmente...\n');

    // Cargar el payload de prueba
    const eventPath = path.join(__dirname, '../events/dian-auth.json');
    
    if (!fs.existsSync(eventPath)) {
        console.error('❌ No se encontró el archivo events/dian-auth.json');
        process.exit(1);
    }

    const event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));

    // Validar que tenga el certificado
    if (event.base64CertificateP12 === 'TU_CERTIFICADO_EN_BASE64_AQUI') {
        console.error('❌ Error: Debes configurar el certificado en events/dian-auth.json');
        console.log('\nPasos:');
        console.log('1. Ejecuta: node scripts/convert-p12-to-base64.js /ruta/a/certificado.p12');
        console.log('2. Copia el base64 generado');
        console.log('3. Pégalo en events/dian-auth.json como valor de "base64CertificateP12"');
        console.log('4. Vuelve a ejecutar este script\n');
        process.exit(1);
    }

    console.log('📦 Payload cargado:');
    console.log(`   - Tipo identificación: ${event.identificationType}`);
    console.log(`   - NIT representante: ${event.nitRepresentanteLegal}`);
    console.log(`   - Headless: ${event.headless}`);
    console.log(`   - Certificado: ${event.base64CertificateP12.substring(0, 50)}...\n`);

    try {
        // Importar el handler compilado
        const handlerPath = path.join(__dirname, '../dist/lambdas/dian/auth/handler.js');
        
        if (!fs.existsSync(handlerPath)) {
            console.log('⚠️  Handler no compilado, compilando TypeScript...\n');
            const { execSync } = require('child_process');
            execSync('npm run build', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
        }

        const { handler } = require(handlerPath);

        // Contexto mock de Lambda
        const context = {
            functionName: 'test-local',
            functionVersion: '1',
            invokedFunctionArn: 'arn:aws:lambda:local:123456789012:function:test',
            memoryLimitInMB: '2048',
            awsRequestId: 'test-request-id',
            logGroupName: '/aws/lambda/test-local',
            logStreamName: 'test-stream',
            getRemainingTimeInMillis: () => 900000,
            done: () => {},
            fail: () => {},
            succeed: () => {}
        };

        console.log('🚀 Ejecutando lambda...\n');
        const startTime = Date.now();

        const result = await handler(event, context);

        const duration = Date.now() - startTime;
        console.log(`\n⏱️  Duración: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);

        console.log('\n📤 Respuesta:');
        console.log(JSON.stringify(result, null, 2));

        // Si hay screenshots, guardarlos opcionalmente
        if (result.body) {
            const body = JSON.parse(result.body);
            if (body.screenshots) {
                const outputDir = path.join(__dirname, '../output');
                if (!fs.existsSync(outputDir)) {
                    fs.mkdirSync(outputDir, { recursive: true });
                }

                if (body.screenshots.beforeSubmit) {
                    const beforePath = path.join(outputDir, 'before-submit.png');
                    fs.writeFileSync(beforePath, Buffer.from(body.screenshots.beforeSubmit, 'base64'));
                    console.log(`\n📸 Screenshot "before submit" guardado en: ${beforePath}`);
                }

                if (body.screenshots.final) {
                    const finalPath = path.join(outputDir, 'final.png');
                    fs.writeFileSync(finalPath, Buffer.from(body.screenshots.final, 'base64'));
                    console.log(`📸 Screenshot "final" guardado en: ${finalPath}`);
                }
            }
        }

        console.log('\n✅ Test completado exitosamente\n');

    } catch (error) {
        console.error('\n❌ Error ejecutando lambda:');
        console.error(error);
        process.exit(1);
    }
}

testGetDianCookieByCertificateLocal();


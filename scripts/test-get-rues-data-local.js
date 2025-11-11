/**
 * Script para probar localmente la lambda de consulta RUES
 * 
 * Uso: node scripts/test-get-rues-data-local.js <número-identificación>
 */

const { handler } = require('../dist/lambdas/get-rues-data');

async function main() {
    const identificationNumber = process.argv[2];

    if (!identificationNumber) {
        console.error('❌ Error: Debes proporcionar un número de identificación');
        console.log('\nUso: node scripts/test-get-rues-data-local.js <número-identificación>');
        console.log('Ejemplo: node scripts/test-get-rues-data-local.js 900123456\n');
        process.exit(1);
    }

    console.log('='.repeat(80));
    console.log('🧪 PRUEBA LOCAL - Lambda de consulta RUES');
    console.log('='.repeat(80));
    console.log(`\n📋 Número de identificación: ${identificationNumber}`);
    console.log(`⏰ Fecha: ${new Date().toLocaleString('es-CO')}\n`);

    const event = {
        identificationNumber,
        headless: false // false para ver el navegador
    };

    console.log('📤 Evento enviado a la lambda:');
    console.log(JSON.stringify(event, null, 2));
    console.log('\n' + '-'.repeat(80));
    console.log('⚙️  Ejecutando lambda...\n');

    const startTime = Date.now();

    try {
        const result = await handler(event);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log('\n' + '-'.repeat(80));
        console.log(`⏱️  Duración: ${duration} segundos`);
        console.log('-'.repeat(80));
        console.log('\n📥 Respuesta de la lambda:');
        console.log(JSON.stringify(result, null, 2));

        if (result.statusCode === 200) {
            const body = JSON.parse(result.body);
            if (body.success) {
                console.log('\n✅ ¡Consulta exitosa!');
                console.log('\n📊 Datos obtenidos:');
                console.log(`   - Nombre: ${body.data.nombre}`);
                console.log(`   - Tipo empresa: ${body.data.tipo_empresa}`);
                console.log(`   - NIT: ${body.data.nit || 'N/A'}`);
                console.log(`   - Estado: ${body.data.estado || 'N/A'}`);
                console.log(`   - Representante legal: ${body.data.representante_legal || 'N/A'}`);
                if (body.data.actividad_economica && body.data.actividad_economica.length > 0) {
                    console.log(`   - Actividades económicas: ${body.data.actividad_economica.length} encontradas`);
                }
            } else {
                console.log('\n❌ Error en la consulta:');
                console.log(`   ${body.error}`);
            }
        } else {
            console.log('\n❌ Error en la lambda (statusCode !== 200)');
        }

        console.log('\n' + '='.repeat(80));
    } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        
        console.log('\n' + '-'.repeat(80));
        console.log(`⏱️  Duración: ${duration} segundos`);
        console.log('-'.repeat(80));
        console.log('\n❌ Error al ejecutar la lambda:');
        console.error(error);
        console.log('\n' + '='.repeat(80));
        process.exit(1);
    }
}

main();


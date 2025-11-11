# AX1 Services

Servicios Lambda para automatización de procesos DIAN.

## 📋 Requisitos

- Node.js 20.x
- AWS CLI configurado
- Credenciales AWS con permisos de Lambda

## 🚀 Despliegue

### Desarrollo (dev)
```bash
npm run build
npx serverless deploy --stage dev
```

### Staging
```bash
npm run build
npx serverless deploy --stage staging
```

### Producción
```bash
npm run build
npx serverless deploy --stage prod
```

## 🔧 Lambdas Disponibles

### `dian-auth` - Autenticación DIAN con Certificado

Obtiene cookies de sesión autenticándose en el portal DIAN usando certificado digital.

#### Parámetros de Entrada

```json
{
  "base64CertificateP12": "string",      // Certificado .p12 en base64
  "certificatePassword": "string",        // Contraseña del certificado
  "identificationType": "string",         // Tipo de identificación (ej: "10910094")
  "nitRepresentanteLegal": "string",      // NIT del representante legal
  "headless": true                        // Opcional: modo headless (default: false)
}
```

#### Parámetros de Salida

**Éxito (statusCode: 200):**
```json
{
  "success": true,
  "certificateAccepted": true,
  "formFilled": true,
  "pageInfo": {
    "title": "string",
    "url": "string",
    "bodyText": "string"
  },
  "screenshots": {
    "beforeSubmit": "string",   // Screenshot en base64 antes de enviar
    "final": "string"            // Screenshot en base64 final
  },
  "cookies": [
    {
      "name": "string",
      "value": "string",
      "domain": "string",
      "path": "string",
      "expires": 1234567890,
      "httpOnly": true,
      "secure": true,
      "sameSite": "Lax"
    }
  ]
}
```

**Error (statusCode: 500):**
```json
{
  "success": false,
  "error": "string"              // Mensaje de error
}
```

### `generate-dian-token-email` - Solicitud de token DIAN por correo

Inicia sesión como representante legal en el catálogo DIAN y dispara el envío del correo que contiene el token de acceso.

#### Parámetros de entrada

```json
{
  "identificationType": "10910094",   // Tipo de identificación de la empresa
  "userCode": "1010168874",           // Documento del representante legal
  "companyCode": "901827899",         // NIT de la empresa
  "origin": "test",                   // Opcional: etiqueta para trazabilidad
  "headless": true                    // Opcional: por defecto true en Lambda
}
```

#### Respuesta exitosa (statusCode: 200)

```json
{
  "success": true,
  "message": "Se ha enviado el código de acceso al correo registrado.",
  "origin": "test"
}
```

#### Respuesta de error (statusCode: 400 o 500)

```json
{
  "success": false,
  "error": "Verifique las credenciales de inicio de sesión.",
  "origin": "test",
  "screenshot": "<base64 opcional para diagnóstico>"
}
```

#### Notas operativas

- Usa `playwright-core` con la layer de Chromium (`@sparticuz/chromium`) en AWS Lambda.
- Reutiliza `resolveCaptcha` (`src/infrastructure/utils/captcha.ts`) para resolver Turnstile vía AntiCaptcha/2Captcha.
- Captura screenshot en base64 cuando ocurre un error, útil para depuración local.

#### Pruebas locales

```bash
npm run build
node scripts/test-generate-dian-token-email-local.js
```

El script carga el payload desde `events/dian-token.json` y ejecuta el handler compilado en `dist/lambdas/generate-dian.token-email`.

### `rues-query` - Consulta RUES con Playwright

Realiza scraping controlado sobre https://www.rues.org.co para obtener información mercantil (RM, ESAL, ESOL). Usa `playwright-core` con la layer `chrome-aws-lambda`, rota proxies Webshare y cierra explícitamente `browser`, `context` y `page` para evitar fugas.

#### Parámetros de entrada

```json
{
  "identificationNumber": "string",   // NIT o identificación a consultar
  "headless": true                    // Opcional; Lambda siempre usa headless=true
}
```

#### Respuesta exitosa (statusCode: 200)

```json
{
  "success": true,
  "data": {
    "nombre": "EMPRESA DEMO S.A.S",
    "tipo_empresa": "Registro Mercantil",
    "identificacion": "901234567",
    "numero_de_inscripcion": "45123",
    "categoria": "SOCIEDAD",
    "camara_de_comercio": "CÁMARA DE COMERCIO DEMO",
    "numero_de_matricula": "12345",
    "estado": "Activa",
    "informacion_general": {
      "municipio": "BOGOTÁ, D.C.",
      "direccion": "CALLE 123 #45-67"
    },
    "actividad_economica": [
      { "ciiu": "6201", "description": "Desarrollo de software" }
    ],
    "representante_legal": "JUAN PÉREZ"
  }
}
```

> Las propiedades pueden variar según la información disponible; la interfaz completa está en `src/domain/rues/interfaces.ts`.

#### Respuestas de error

- **404** (`NOT_FOUND`): `"Documento <id> no encontrado en ningún tipo de registro (RM, ESAL, ESOL)."`
- **503** (`API_ERROR`): La API de RUES no respondió después de varios intentos.
- **500**: Errores inesperados (fallas del sitio, timeouts, etc.).

#### Notas operativas

- Rotación de IP: usa `getNextProxy()` (`src/infrastructure/config/proxies.ts`) con proxies Webshare en modo round-robin.
- Sincronización con UI: espera al spinner del botón “Buscar” antes de leer resultados para evitar respuestas inconsistentes.
- Recursos de navegador: cierra `page`, `context` y `browser` en el bloque `finally`.
- Timeouts configurados a 120 s por acción y reintentos en pestañas de detalle para mitigar lentitud del sitio.
- Variables dependientes del entorno (credenciales, API keys) provienen del archivo `env.<stage>.yml` cargado por Serverless.

#### Pruebas locales

```bash
npm run build
node scripts/test-get-rues-data-local.js <IDENTIFICACION>
```

El script usa el handler compilado en `dist/lambdas/get-rues-data` y permite observar la respuesta completa de la lambda.

## 🧪 Pruebas Locales

### Invocar lambdas desplegadas
```bash
npx serverless invoke -f dian-auth -p events/dian-auth.json --log
npx serverless invoke -f generate-dian-token-email -p events/dian-token.json --log
npx serverless invoke -f rues-query -p events/rues-query.json --log
```

### Archivos de ejemplo
- `events/dian-auth.json`
- `events/dian-token.json`
- `events/rues-query.json`

## 📁 Estructura del Proyecto

```
ax1-services/
├── src/
│   ├── application/          # Lógica de negocio
│   ├── domain/              # Interfaces y tipos
│   └── infrastructure/
│       ├── config/          # Configuraciones (proxies, etc.)
│       └── utils/           # Utilidades compartidas
├── lambdas/                 # Handlers de lambdas
├── events/                  # Payloads de ejemplo
└── serverless.yml           # Configuración Serverless
```

## 🔑 Variables de Entorno

Las variables se configuran en:
- `env.dev.yml` (desarrollo)
- `env.staging.yml` (staging)
- `env.prod.yml` (producción)

Ejemplo:
```yaml
ANTICAPTCHA_API_KEY: "tu-api-key"
CAPTCHA_2_API_KEY: "tu-api-key"
```

## 📝 Notas

- La lambda usa Playwright con Chromium para automatización del navegador
- Memoria configurada: 2048 MB
- Timeout: 15 minutos (900 segundos)
- Tamaño del paquete desplegado: ~66 MB


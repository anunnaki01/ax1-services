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

## 🧪 Pruebas Locales

### Invocar lambda desplegada
```bash
npx serverless invoke -f dian-auth -p events/dian-auth.json --log
```

### Archivo de ejemplo
Ver `events/dian-auth-example.json` para la estructura del payload.

## 📁 Estructura del Proyecto

```
ax1-services/
├── src/
│   ├── application/          # Lógica de negocio
│   ├── domain/              # Interfaces y tipos
│   └── utils/               # Utilidades compartidas
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


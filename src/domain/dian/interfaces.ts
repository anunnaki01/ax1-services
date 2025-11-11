export interface Payload {
    base64CertificateP12: string;
    certificatePassword: string;
    identificationType: string;
    nitRepresentanteLegal: string;
    headless?: boolean;
}

export interface DianTokenEmailPayload {
    identificationType: string;
    userCode: string;
    companyCode: string;
    origin?: string;
    headless?: boolean;
}

export interface DianTokenEmailResult {
    success: boolean;
    message?: string;
    error?: string;
    origin?: string;
    screenshot?: string;
}

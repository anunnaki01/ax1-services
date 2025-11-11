export interface Payload {
    base64CertificateP12: string;
    certificatePassword: string;
    identificationType: string;
    nitRepresentanteLegal: string;
    headless?: boolean;
}

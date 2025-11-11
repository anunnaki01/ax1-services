/**
 * Lista de proxies de Webshare
 * Formato: IP:PORT:USERNAME:PASSWORD
 */
export const WEBSHARE_PROXIES = [
    '142.111.48.253:7030:hzggpbol:xqrp7h734xyj',
    '31.59.20.176:6754:hzggpbol:xqrp7h734xyj',
    '23.95.150.145:6114:hzggpbol:xqrp7h734xyj',
    '198.23.239.134:6540:hzggpbol:xqrp7h734xyj',
    '45.38.107.97:6014:hzggpbol:xqrp7h734xyj',
    '107.172.163.27:6543:hzggpbol:xqrp7h734xyj',
    '198.105.121.200:6462:hzggpbol:xqrp7h734xyj',
    '64.137.96.74:6641:hzggpbol:xqrp7h734xyj',
    '216.10.27.159:6837:hzggpbol:xqrp7h734xyj',
    '142.111.67.146:5611:hzggpbol:xqrp7h734xyj',
];

let proxyIndex = Math.floor(Math.random() * WEBSHARE_PROXIES.length);

export interface ProxyConfig {
    server: string;
    username: string;
    password: string;
}

/**
 * Devuelve el siguiente proxy en modo round-robin
 */
export function getNextProxy(): ProxyConfig | null {
    if (WEBSHARE_PROXIES.length === 0) {
        return null;
    }

    const proxy = WEBSHARE_PROXIES[proxyIndex % WEBSHARE_PROXIES.length];
    proxyIndex = (proxyIndex + 1) % WEBSHARE_PROXIES.length;

    const [ip, port, username, password] = proxy.split(':');

    return {
        server: `http://${ip}:${port}`,
        username,
        password,
    };
}


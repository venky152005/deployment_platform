import fs from "fs";
import path from "path";
import { exec as _exec } from "child_process";
import util from "util";

const exec = util.promisify(_exec);

const SITES_AVAILABLE = "/etc/nginx/sites-available";
const SITES_ENABLED = "/etc/nginx/sites-enabled";
const CERT_PATH = "/etc/letsencrypt/live/jitalumni.site";

export const createNginxConfig = async (subdomain: string, hostport: number) => {
    const host = `${subdomain}.jitalumni.site`
    return `
server {
  listen 80;
  server_name ${host};
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name ${host};

  ssl_certificate ${CERT_PATH}/fullchain.pem;
  ssl_certificate_key ${CERT_PATH}/privkey.pem;
  ssl_session_cache shared:SSL:10m;
  ssl_session_timeout 10m;
  ssl_protocols TLSv1.2 TLSv1.3;

  location / {
    proxy_pass http://127.0.0.1:${hostport};
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
  }
}
`.trim();
}

export const enableNginxConfig = async (subdomain: string, config: string) => {
    const filename = `${subdomain}.jitalumni.site.conf`;
    const availablePath = path.join(SITES_AVAILABLE, filename);
    const enabledPath = path.join(SITES_ENABLED, filename);

    fs.writeFileSync(availablePath, config, 'utf-8');
    if (!fs.existsSync(enabledPath)) {
        fs.symlinkSync(availablePath, enabledPath);
    }

    await exec("sudo nginx -t");

    await exec("sudo systemctl reload nginx");

    console.log(`Nginx configuration for ${subdomain} enabled.`);
    return { availablePath, enabledPath };
}

export const disableNginxConfig = async (subdomain: string) => {
    const filename = `${subdomain}.jitalumni.site.conf`;
    const availablePath = path.join(SITES_AVAILABLE, filename);
    const enabledPath = path.join(SITES_ENABLED, filename);
    if (fs.existsSync(enabledPath)) {
        fs.unlinkSync(enabledPath);
    }
    if (fs.existsSync(availablePath)) {
        fs.unlinkSync(availablePath);
    }

    await exec("sudo nginx -t");
    await exec("sudo systemctl reload nginx");

    console.log(`Nginx configuration for ${subdomain} disabled and removed.`);
}
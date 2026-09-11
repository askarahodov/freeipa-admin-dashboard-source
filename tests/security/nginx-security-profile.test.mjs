import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profilePath = new URL("../../deploy/nginx/portal.conf.template", import.meta.url);
const profile = () => readFile(profilePath, "utf8");

test("Nginx TLS profile replaces untrusted forwarding metadata", async () => {
  const config = await profile();
  assert.match(config, /listen 443 ssl http2;/);
  assert.match(config, /ssl_protocols TLSv1\.2 TLSv1\.3;/);
  assert.match(config, /proxy_set_header X-Forwarded-Proto https;/);
  assert.match(config, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.match(config, /proxy_set_header X-Portal-Proxy-Secret \$\{PORTAL_TRUSTED_PROXY_SECRET\};/);
  assert.doesNotMatch(config, /\$proxy_add_x_forwarded_for/);
});

test("Nginx template preserves runtime variables and redirects HTTP to HTTPS", async () => {
  const config = await profile();
  assert.match(config, /envsubst '\$\{PORTAL_UPSTREAM_HOST\} \$\{PORTAL_SERVER_NAME\} \$\{TLS_CERTIFICATE\} \$\{TLS_CERTIFICATE_KEY\} \$\{PORTAL_TRUSTED_PROXY_SECRET\}'/);
  assert.match(config, /return 308 https:\/\/\$host\$request_uri;/);
});

test("Nginx profile bounds requests/timeouts and covers the largest supported restore request", async () => {
  const config = await profile();
  assert.match(config, /client_max_body_size 42m;/);
  assert.match(config, /client_body_timeout 30s;/);
  assert.match(config, /proxy_connect_timeout 5s;/);
  assert.match(config, /proxy_send_timeout 60s;/);
  assert.match(config, /proxy_read_timeout 60s;/);
  assert.match(config, /proxy_set_header Upgrade "";/);
  assert.match(config, /proxy_set_header Connection "";/);
});

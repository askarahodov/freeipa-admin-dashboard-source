FROM node:22-bookworm

WORKDIR /work

COPY e2e/package.json ./package.json
RUN npm install --package-lock=false --no-audit --no-fund \
  && npx playwright install --with-deps chromium

COPY e2e/playwright.config.mjs ./playwright.config.mjs
COPY e2e/specs ./specs

CMD ["npx", "playwright", "test", "--config=playwright.config.mjs"]

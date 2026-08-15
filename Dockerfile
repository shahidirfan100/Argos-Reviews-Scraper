FROM apify/actor-node:22

COPY --chown=myuser:myuser package*.json ./

RUN npm --quiet set progress=false \
    && npm install --omit=dev \
    && node -e "import('impit').then(m => console.log('impit OK:', Object.keys(m)))" \
    && (npm list --omit=dev --all || true) \
    && rm -r ~/.npm

COPY --chown=myuser:myuser . ./

ENV APIFY_LOG_LEVEL=INFO

CMD npm start --silent

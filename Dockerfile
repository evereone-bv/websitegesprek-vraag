# Vraagbaak Websitegesprek. Kleine Node-dienst, zonder extra pakketten.
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8090 \
    VRAAG_DATA_DIR=/data

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY venster ./venster
COPY testset ./testset
COPY kennisbank ./kennisbank

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8090
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.mjs"]

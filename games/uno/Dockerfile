# UNO game service. Build context is the REPO ROOT (see docker-compose.yml) so the
# image includes core/ — server.js does require('../../core').
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 5050
CMD ["node", "games/uno/server.js"]

# Texas Hold'em game service. Build context is the REPO ROOT so the image includes
# core/ — server.js does require('../../core').
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 5070
CMD ["node", "games/holdem/server.js"]

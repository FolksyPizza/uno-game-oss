# Rosemont Games hub service. Build context is the REPO ROOT so the image includes
# core/ — hub/server.js does require('../core').
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 5060
CMD ["node", "hub/server.js"]

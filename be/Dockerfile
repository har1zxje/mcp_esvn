FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY schema.sql ./schema.sql
COPY scripts ./scripts
EXPOSE 3091
CMD ["npm", "start"]

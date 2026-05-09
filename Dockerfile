FROM node:20-alpine

# Install system dependencies for Sharp and Tesseract
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    tesseract-ocr \
    tesseract-ocr-data-eng

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npm run prisma:generate
RUN npm run build

RUN mkdir -p /app/uploads

EXPOSE 3000

CMD ["npm", "start"]

FROM node:18-slim

RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /tmp/uploads /tmp/outputs

EXPOSE 7860

ENV PORT=7860

USER user

CMD ["node", "backend/server.js"]

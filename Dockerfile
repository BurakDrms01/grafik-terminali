# Grafik Terminali: derlenmiş uygulamayı ve Yahoo aracısını (vite preview) sunar.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx vite build
EXPOSE 5173
# Konteyner içinde tüm arayüzlerde dinler; dışarıya hangi adresten açılacağını docker-compose belirler.
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]

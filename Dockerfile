FROM node:20-slim

# Instalar dependencias del sistema
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    nodejs \
    nodejs \
    && rm -rf /var/lib/apt/lists/*

# Instalar yt-dlp (ignorar restricciones de Debian Bookworm)
RUN pip3 install --break-system-packages yt-dlp

# Directorio de trabajo
WORKDIR /app

# Copiar dependencias primero (aprovecha cache de Docker)
COPY package*.json ./
RUN npm install --production

# Copiar el resto del código
COPY . .

# Crear carpeta de descargas temporales
RUN mkdir -p temp_downloads

# Railway asigna el puerto dinámicamente — no usar EXPOSE fijo
# EXPOSE se documenta sólo como referencia
EXPOSE 3000

# Comando de inicio
CMD ["node", "server.js"]

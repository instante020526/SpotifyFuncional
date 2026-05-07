FROM node:20-slim

# ================================
# SISTEMA BASE
# ================================
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ================================
# yt-dlp (VERSIÓN ESTABLE)
# ================================
RUN pip3 install --no-cache-dir --break-system-packages -U yt-dlp

# ================================
# WORKDIR
# ================================
WORKDIR /app

# ================================
# DEPENDENCIAS NODE
# ================================
COPY package*.json ./
RUN npm install --production

# ================================
# CÓDIGO
# ================================
COPY . .

# ================================
# TEMP DIR
# ================================
RUN mkdir -p temp_downloads cache

# ================================
# PORT (RAILWAY)
# ================================
EXPOSE 3000

# ================================
# START
# ================================
CMD ["node", "server.js"]
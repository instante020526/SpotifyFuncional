const express = require("express");
const yts = require("yt-search");
const { exec, execSync } = require("child_process");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");

// Spotify
let getTracks;
try {
    const fetch = require('node-fetch');
    getTracks = require('spotify-url-info')(fetch).getTracks;
} catch (e) {
    console.log("⚠️ Error cargando librerías de Spotify. Ejecuta: npm install spotify-url-info node-fetch@2");
}

const app = express();
app.use(cors());

// ✅ Cookies de YouTube
const COOKIES_PATH = '/tmp/yt-cookies.txt';
if (process.env.YOUTUBE_COOKIES) {
    fs.writeFileSync(COOKIES_PATH, process.env.YOUTUBE_COOKIES);
    console.log("🍪 Cookies de YouTube cargadas.");
} else {
    console.log("⚠️ Sin cookies de YouTube.");
}

// Servir archivos estáticos
const publicPath = path.resolve(__dirname);
app.use(express.static(publicPath));

// Carpeta temporal para descargas
const DOWNLOADS_DIR = path.join(publicPath, 'temp_downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

// Helper: ejecutar comando externo con Promise
function execPromise(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
            if (error) reject(error);
            else resolve(stdout);
        });
    });
}

// Helper: crear ZIP con Promise
function crearZip(sourceFolder, zipPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(sourceFolder, false);
        archive.finalize();
    });
}

// Ruta principal
app.get('/', (req, res) => {
    const filePath = path.join(__dirname, 'index.html');
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('Error al enviar index.html:', err);
            res.status(500).send('No se pudo cargar la página');
        }
    });
});

// Ruta de progreso SSE
app.get("/playlist-progress", async (req, res) => {
    const url = req.query.url;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const sendProgress = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const keepAlive = setInterval(() => {
        res.write(': keepalive\n\n');
    }, 20000);

    try {
        let cancionesParaBuscar = [];
        const esSpotify = url.includes('spotify.com');

        if (esSpotify) {
            if (!getTracks) throw new Error("Librería Spotify no disponible en el servidor.");
            sendProgress({ status: "Analizando lista de Spotify..." });
            const tracks = await getTracks(url);
            cancionesParaBuscar = tracks.map(t => {
                const nombre = t.name || "Canción desconocida";
                const artista = (t.artists && t.artists.length > 0) ? t.artists[0].name : "";
                return artista ? `${nombre} ${artista}` : nombre;
            });
        } else {
            sendProgress({ status: "Analizando lista de YouTube..." });
            const rawIds = await execPromise(`yt-dlp --get-id --flat-playlist "${url}"`);
            cancionesParaBuscar = rawIds.trim().split('\n')
                .filter(Boolean)
                .map(id => `https://www.youtube.com/watch?v=${id.trim()}`);
        }

        const total = cancionesParaBuscar.length;
        if (total === 0) throw new Error("No se encontraron canciones en el enlace.");

        const folderName = `lista-${Date.now()}`;
        const folderPath = path.join(DOWNLOADS_DIR, folderName);
        fs.mkdirSync(folderPath, { recursive: true });

        for (let i = 0; i < total; i++) {
            const cancion = cancionesParaBuscar[i];
            sendProgress({
                status: `Descargando ${i + 1} de ${total}: ${cancion.substring(0, 40)}...`,
                current: i + 1,
                total: total
            });

            // ✅ Proxy residencial para evitar bloqueo de YouTube
            console.log(`🎵 Buscando: ${cancion}`);
            const cancionLimpia = cancion.replace(/[\/\\:*?"<>|]/g, ' ').trim();
            const proxyFlag = process.env.PROXY_URL ? `--proxy "${process.env.PROXY_URL}"` : '';
            const cookiesFlag = fs.existsSync(COOKIES_PATH) ? `--cookies ${COOKIES_PATH}` : '';
            const comando = esSpotify
                ? `yt-dlp ${proxyFlag} ${cookiesFlag} -x --audio-format mp3 --no-playlist -o "${folderPath}/%(title)s.%(ext)s" "scsearch1:${cancionLimpia}"`
                : `yt-dlp ${proxyFlag} ${cookiesFlag} -x --audio-format mp3 --no-playlist -o "${folderPath}/%(title)s.%(ext)s" "${cancion}"`;

            try {
                await execPromise(comando);
            } catch (e) {
                console.error(`⚠️ Error descargando: ${cancion} — ${e.message}`);
            }
        }

        sendProgress({ status: "Comprimiendo archivos en un ZIP..." });

        const zipName = `${folderName}.zip`;
        const zipPath = path.join(DOWNLOADS_DIR, zipName);
        await crearZip(folderPath, zipPath);

        fs.rmSync(folderPath, { recursive: true, force: true });

        sendProgress({ status: "Completado", file: zipName });
        clearInterval(keepAlive);
        res.end();

    } catch (error) {
        console.error("ERROR:", error.message);
        sendProgress({ status: "Error: " + error.message });
        clearInterval(keepAlive);
        res.end();
    }
});

// Ruta para descargar ZIP
app.get("/get-zip", (req, res) => {
    const fileName = path.basename(req.query.file);
    const filePath = path.join(DOWNLOADS_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send("Archivo no encontrado.");
    }

    res.download(filePath, (err) => {
        if (!err && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    });
});

// Ruta de búsqueda
app.get("/search", async (req, res) => {
    try {
        const result = await yts(req.query.q || "");
        res.json(result.videos.slice(0, 5).map(v => ({
            title: v.title,
            url: v.url,
            thumbnail: v.thumbnail
        })));
    } catch (e) {
        res.status(500).json({ error: "Fallo en la búsqueda" });
    }
});

// Ruta de prueba
app.get('/ping', (req, res) => {
    res.send('pong');
});

// Puerto dinámico para Railway
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log("============================================");
    console.log("✅ SERVIDOR MULTIMEDIA INICIADO");
    console.log(`📂 Carpeta: ${publicPath}`);
    console.log(`🌐 URL Local: http://localhost:${PORT}/`);
    console.log("============================================");
});
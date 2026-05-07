const express = require("express");
const yts = require("yt-search");
const { exec } = require("child_process");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");

let getTracks;
try {
    const fetch = require("node-fetch");
    getTracks = require("spotify-url-info")(fetch).getTracks;
} catch (e) {
    console.log("⚠️ Spotify library no disponible. Ejecuta: npm install spotify-url-info node-fetch@2");
}

const app = express();
app.use(cors());

const publicPath = path.resolve(__dirname);
app.use(express.static(publicPath));

const DOWNLOADS_DIR = path.join(publicPath, "temp_downloads");
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

function execPromise(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 180000 }, (error, stdout, stderr) => {
            if (error) return reject(stderr || error.message);
            resolve(stdout);
        });
    });
}

function crearZip(sourceFolder, zipPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 9 } });

        output.on("close", resolve);
        archive.on("error", reject);

        archive.pipe(output);
        archive.directory(sourceFolder, false);
        archive.finalize();
    });
}

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/playlist-progress", async (req, res) => {
    const url = req.query.url;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const keepAlive = setInterval(() => {
        res.write(": keepalive\n\n");
    }, 20000);

    try {
        let canciones = [];
        const esSpotify = url.includes("spotify.com");

        send({ status: "Analizando enlace..." });

        if (esSpotify) {
            if (!getTracks) throw new Error("Spotify no disponible");

            const tracks = await getTracks(url);

            canciones = tracks.map(t => {
                const name = t.name || "Unknown";
                const artist = t.artists?.[0]?.name || "";
                return artist ? `${name} ${artist}` : name;
            });

        } else {
            const raw = await execPromise(`yt-dlp --flat-playlist --get-title "${url}"`);
            canciones = raw.split("\n").filter(Boolean);
        }

        const total = canciones.length;
        const folderName = `lista-${Date.now()}`;
        const folderPath = path.join(DOWNLOADS_DIR, folderName);

        fs.mkdirSync(folderPath, { recursive: true });

        for (let i = 0; i < total; i++) {
            const song = canciones[i];
            const clean = song.replace(/[\/\\:*?"<>|]/g, "").trim();

            send({
                status: `Descargando ${i + 1}/${total}: ${song}`,
                current: i + 1,
                total
            });

            const baseCmd = `
yt-dlp "ytsearch1:${clean}" \
-x \
--audio-format mp3 \
--no-playlist \
--extractor-args "youtube:player_client=android" \
--format "bestaudio[ext=m4a]/bestaudio" \
-o "${folderPath}/%(title)s.%(ext)s"
`;

            try {
                await execPromise(baseCmd);
            } catch (err) {
                console.log("Fallback YouTube directo...");

                const fallbackCmd = `
yt-dlp "${clean}" \
-x \
--audio-format mp3 \
--no-playlist \
--extractor-args "youtube:player_client=android" \
-o "${folderPath}/%(title)s.%(ext)s"
`;

                try {
                    await execPromise(fallbackCmd);
                } catch (err2) {
                    console.log("❌ Error:", song);
                }
            }
        }

        send({ status: "Comprimiendo ZIP..." });

        const zipName = `${folderName}.zip`;
        const zipPath = path.join(DOWNLOADS_DIR, zipName);

        await crearZip(folderPath, zipPath);
        fs.rmSync(folderPath, { recursive: true, force: true });

        clearInterval(keepAlive);

        send({
            status: "Completado",
            file: zipName
        });

        res.end();

    } catch (err) {
        console.error("ERROR:", err);
        clearInterval(keepAlive);

        send({
            status: "Error: " + err.toString()
        });

        res.end();
    }
});

app.get("/get-zip", (req, res) => {
    const file = path.basename(req.query.file);
    const filePath = path.join(DOWNLOADS_DIR, file);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send("Archivo no encontrado");
    }

    res.download(filePath, () => {
        fs.unlinkSync(filePath);
    });
});

app.get("/search", async (req, res) => {
    try {
        const r = await yts(req.query.q || "");
        res.json(r.videos.slice(0, 5));
    } catch (e) {
        res.status(500).json({ error: "search failed" });
    }
});

app.get("/ping", (req, res) => {
    res.send("ok");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log("🚀 Server running on port", PORT);
});
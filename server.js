const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const archiver = require("archiver");

const app = express();
app.use(cors());

/*
========================================================
📁 DIRECTORIOS
========================================================
*/
const BASE_DIR = __dirname;
const DOWNLOAD_DIR = path.join(BASE_DIR, "temp_downloads");

if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

/*
========================================================
⚙️ EXEC PROMISE
========================================================
*/
function run(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { timeout: 180000 }, (err, stdout, stderr) => {
            if (err) return reject(stderr || err.message);
            resolve(stdout.trim());
        });
    });
}

/*
========================================================
📦 ZIP SEGURO (NO VACÍO)
========================================================
*/
function createZip(folder, zipPath) {
    return new Promise((resolve, reject) => {
        const files = fs.readdirSync(folder);

        if (!files.length) {
            return reject(new Error("No hay archivos descargados"));
        }

        const output = fs.createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 9 } });

        output.on("close", resolve);
        archive.on("error", reject);

        archive.pipe(output);
        archive.directory(folder, false);
        archive.finalize();
    });
}

/*
========================================================
🏠 HOME (FIX “Cannot GET /”)
========================================================
*/
app.get("/", (req, res) => {
    res.sendFile(path.join(BASE_DIR, "index.html"));
});

/*
========================================================
🔥 STREAM DIRECTO (MODO PRO)
========================================================
*/
app.get("/stream", async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("Falta query");

    try {
        const url = await run(`
            yt-dlp -f bestaudio -g "ytsearch5:${q}" | head -n 1
        `);

        if (!url) throw new Error("No stream");

        return res.redirect(url);

    } catch (e) {
        return res.status(500).send("No disponible");
    }
});

/*
========================================================
⬇️ DESCARGA PRO ROBUSTA
========================================================
*/
app.get("/download", async (req, res) => {
    const q = req.query.q;
    if (!q) return res.status(400).send("Falta query");

    const folder = path.join(DOWNLOAD_DIR, Date.now().toString());
    fs.mkdirSync(folder, { recursive: true });

    const cmd = `
yt-dlp "ytsearch5:${q}" \
-f "bestaudio[ext=m4a]/bestaudio" \
--extractor-args "youtube:player_client=android" \
--no-check-certificate \
-x --audio-format mp3 \
--no-playlist \
-o "${folder}/%(title)s.%(ext)s"
`;

    try {
        await run(cmd);

        const files = fs.readdirSync(folder);

        if (!files.length) {
            fs.rmSync(folder, { recursive: true, force: true });
            return res.status(500).json({ error: "No se descargó nada" });
        }

        return res.json({
            ok: true,
            folder,
            files
        });

    } catch (e) {
        return res.status(500).json({ error: "fallo descarga", details: e.toString() });
    }
});

/*
========================================================
📦 ZIP DESCARGA FINAL (FIX 22 bytes)
========================================================
*/
app.get("/get-zip", async (req, res) => {
    const folder = req.query.file;
    const folderPath = path.join(DOWNLOAD_DIR, folder);

    if (!fs.existsSync(folderPath)) {
        return res.status(404).send("No existe");
    }

    const zipPath = folderPath + ".zip";

    try {
        await createZip(folderPath, zipPath);

        res.download(zipPath, () => {
            fs.rmSync(folderPath, { recursive: true, force: true });
            fs.unlinkSync(zipPath);
        });

    } catch (e) {
        res.status(500).send("Error zip: " + e.message);
    }
});

/*
========================================================
🔎 SEARCH PRO
========================================================
*/
app.get("/search", async (req, res) => {
    const q = req.query.q;
    if (!q) return res.json([]);

    try {
        const result = await run(`yt-dlp "ytsearch5:${q}" --print "%(title)s"`);

        const list = result.split("\n").filter(Boolean);

        res.json(list.map(t => ({ title: t })));

    } catch (e) {
        res.status(500).json({ error: "search failed" });
    }
});

/*
========================================================
❤️ HEALTHCHECK
========================================================
*/
app.get("/ping", (req, res) => {
    res.send("ok");
});

/*
========================================================
🚀 START RAILWAY
========================================================
*/
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log("🚀 PRO SERVER RUNNING ON", PORT);
});
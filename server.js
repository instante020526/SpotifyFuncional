const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());

const CACHE_DIR = path.join(__dirname, "cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

// Ejecutar comandos
function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) return reject(stderr || err.message);
      resolve(stdout.trim());
    });
  });
}

/*
========================================================
 🔥 STREAM DIRECTO (NO DESCARGA MP3)
========================================================
*/

app.get("/stream", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send("Falta query");

  try {
    // 1. Buscar URL directa de audio (yt-dlp modo PRO)
    const cmd = `
      yt-dlp -f bestaudio -g "ytsearch1:${query}"
    `;

    const url = await run(cmd);

    if (!url) throw new Error("No se encontró stream");

    // Redirigir al audio directo
    res.redirect(url);

  } catch (err) {
    console.log("YT falló, intentando fallback...");

    try {
      // 2. fallback simple (YouTube search normal)
      const fallback = await run(`
        yt-dlp -f bestaudio -g "${query}"
      `);

      return res.redirect(fallback);

    } catch (err2) {
      return res.status(500).send("No disponible");
    }
  }
});

/*
========================================================
 🔥 DESCARGA OPCIONAL (ZIP SIMPLE)
========================================================
*/

app.get("/download", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send("Falta query");

  const folder = path.join(CACHE_DIR, Date.now().toString());
  fs.mkdirSync(folder);

  try {
    const cmd = `
      yt-dlp "ytsearch1:${query}" \
      -x \
      --audio-format mp3 \
      --no-playlist \
      --format "bestaudio[ext=m4a]/bestaudio" \
      --extractor-args "youtube:player_client=android" \
      -o "${folder}/%(title)s.%(ext)s"
    `;

    await run(cmd);

    return res.json({
      ok: true,
      message: "Descarga completa",
      folder
    });

  } catch (err) {
    return res.status(500).json({ error: "fallo descarga" });
  }
});

/*
========================================================
 🔥 SEARCH SIMPLE (METADATA)
========================================================
*/

app.get("/search", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);

  try {
    const cmd = `yt-dlp "ytsearch5:${query}" --print "%(title)s"`;
    const result = await run(cmd);

    const list = result.split("\n").filter(Boolean);

    res.json(list.map(t => ({ title: t })));

  } catch (err) {
    res.status(500).json({ error: "search failed" });
  }
});

/*
========================================================
 🔥 HEALTHCHECK
========================================================
*/

app.get("/ping", (req, res) => {
  res.send("ok");
});

/*
========================================================
 🚀 START SERVER (RAILWAY)
========================================================
*/

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server listo en puerto", PORT);
});
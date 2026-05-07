const express = require("express");
const cors = require("cors");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());

const DOWNLOAD_DIR = path.join(__dirname, "temp");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

// -------------------- RUN --------------------
function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) return reject(stderr || err.message);
      resolve(stdout.trim());
    });
  });
}

// -------------------- FRONTEND --------------------
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// -------------------- SSE PROGRESS --------------------
app.get("/playlist-progress", async (req, res) => {
  const url = req.query.url;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Connection", "keep-alive");

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send({ status: "Analizando lista..." });

    let songs = [];

    // Spotify o YouTube
    if (url.includes("spotify")) {
      const cmd = `yt-dlp "ytsearch10:${url}" --print "%(title)s"`;
      const output = await run(cmd);
      songs = output.split("\n").filter(Boolean);
    } else {
      const cmd = `yt-dlp --flat-playlist --print "%(title)s" "${url}"`;
      const output = await run(cmd);
      songs = output.split("\n").filter(Boolean);
    }

    const folder = `list-${Date.now()}`;
    const folderPath = path.join(DOWNLOAD_DIR, folder);
    fs.mkdirSync(folderPath);

    for (let i = 0; i < songs.length; i++) {
      const song = songs[i];

      send({
        status: `Descargando ${i + 1}/${songs.length}: ${song}`
      });

      const clean = song.replace(/[^\w\s]/gi, "");

      const cmd = `
        yt-dlp "ytsearch1:${clean}" \
        -x \
        --audio-format mp3 \
        --no-playlist \
        -o "${folderPath}/%(title)s.%(ext)s"
      `;

      try {
        await run(cmd);
      } catch (e) {
        console.log("fallo:", song);
      }
    }

    send({ status: "COMPLETADO", file: folder });

    res.end();

  } catch (err) {
    send({ status: "ERROR: " + err });
    res.end();
  }
});

// -------------------- ZIP DOWNLOAD --------------------
const archiver = require("archiver");

app.get("/get-zip", (req, res) => {
  const file = req.query.file;
  const folderPath = path.join(DOWNLOAD_DIR, file);

  if (!fs.existsSync(folderPath)) {
    return res.status(404).send("No existe");
  }

  const zipPath = path.join(DOWNLOAD_DIR, file + ".zip");

  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip", {
    zlib: { level: 9 }
  });

  output.on("close", () => {
    res.download(zipPath, () => {
      try {
        fs.rmSync(folderPath, { recursive: true, force: true });
        fs.unlinkSync(zipPath);
      } catch (e) {
        console.log("cleanup error:", e);
      }
    });
  });

  archive.on("error", (err) => {
    console.error("ZIP ERROR:", err);
    res.status(500).send("Error creando ZIP");
  });

  archive.pipe(output);
  archive.directory(folderPath, false);
  archive.finalize();
});

// -------------------- HEALTH --------------------
app.get("/ping", (req, res) => {
  res.send("ok");
});

// -------------------- START --------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Spotify Funcional PRO en puerto", PORT);
});
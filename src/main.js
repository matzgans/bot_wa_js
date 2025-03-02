const { Client, LocalAuth } = require("whatsapp-web.js");
const express = require("express");
const QRCode = require("qrcode");
const authMiddleware = require("./authMiddleware");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

let isClientReady = false;
let qrCode = null;
let client;

const sessionPath = path.join(__dirname, ".wwebjs_auth");

// Fungsi menghapus sesi dengan aman
const deleteSession = async () => {
  console.log("🔄 Menghapus sesi...");

  try {
    if (client) {
      await client.destroy();
      client = null;
    }

    if (fs.existsSync(sessionPath)) {
      const tempPath = `${sessionPath}_old`;

      // Rename untuk menghindari file terkunci
      fs.renameSync(sessionPath, tempPath);
      console.log("📂 Folder sesi di-rename sementara...");

      // Tunggu hingga sistem tidak mengunci folder
      setTimeout(async () => {
        try {
          if (fs.existsSync(tempPath)) {
            await fs.promises.rm(tempPath, { recursive: true, force: true });
            console.log("✅ Folder sesi berhasil dihapus.");
          }
        } catch (err) {
          console.error("❌ Gagal menghapus folder sesi:", err.message);
        }
      }, 5000);
    }
  } catch (error) {
    console.error("❌ Gagal menghapus sesi:", error.message);
  }
};

// Fungsi untuk inisialisasi ulang client
const initializeClient = async () => {
  if (client) {
    console.warn("⚠️ Client masih aktif, tidak perlu restart.");
    return;
  }

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: ".wwebjs_auth",
    }),
    puppeteer: {
      headless: true, // Jalankan di background
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  console.log("🔄 Bot aktif, menunggu koneksi...");

  client.on("ready", () => {
    console.log("✅ Client sudah login!");
    isClientReady = true;
    qrCode = null;
  });

  client.on("qr", (qr) => {
    console.log("📌 QR Code baru dibuat.");
    qrCode = qr;
    isClientReady = false;
  });

  client.on("disconnected", async (reason) => {
    console.warn("⚠️ Client terlogout:", reason);

    if (reason === "NAVIGATION" || reason === "LOGOUT") {
      await deleteSession();
      console.log("🔄 Memulai ulang bot...");
      setTimeout(() => initializeClient(), 6000);
    }
  });

  client.on("auth_failure", async (msg) => {
    console.error("🚨 Autentikasi gagal:", msg);
    await deleteSession();
    console.log("🔄 Memulai ulang bot...");
    setTimeout(() => initializeClient(), 6000);
  });

  client.on("change_state", (state) => {
    console.log(`🔄 State berubah: ${state}`);
  });

  client.on("error", (error) => {
    console.error("❌ Error terjadi:", error.message);
    if (error.message.includes("Execution context was destroyed")) {
      console.log("🔄 Error eksekusi, restart client...");
      setTimeout(() => initializeClient(), 6000);
    }
  });

  client.initialize();
};

// Jalankan bot pertama kali
initializeClient();

app.get("/status", (req, res) => {
  res.json({
    status: isClientReady
      ? "✅ Client sudah login"
      : "⏳ Client belum login, silakan scan QR",
  });
});

app.get("/generate_qr", authMiddleware, (req, res) => {
  if (isClientReady) {
    return res.json({
      message: "✅ Client sudah login. Tidak perlu scan QR lagi.",
    });
  }

  if (qrCode) {
    QRCode.toDataURL(qrCode, (err, url) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ message: "❌ Gagal menghasilkan QR code" });
      }
      return res.json({
        message: "📌 Silakan scan QR ini untuk login.",
        qr: url,
      });
    });
  } else {
    res.json({ message: "⏳ QR belum tersedia, mohon tunggu sebentar." });
  }
});

app.post("/message", authMiddleware, async (req, res) => {
  const { number, message } = req.body;

  if (!isClientReady) {
    return res
      .status(400)
      .json({ message: "⏳ Client belum login. Silakan scan QR dulu." });
  }

  try {
    const chatId = number.includes("@c.us") ? number : `${number}@c.us`;
    await client.sendMessage(chatId, message);
    res.json({ success: true, message: "📩 Pesan berhasil dikirim." });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/logout", authMiddleware, async (req, res) => {
  if (!isClientReady) {
    return res.json({
      message: "⏳ Client belum login. Silakan klik tombol generate QR.",
    });
  }

  try {
    console.log("🔄 Melakukan logout...");

    if (client) {
      await client.destroy();
      client = null;
    }

    if (fs.existsSync(sessionPath)) {
      console.log("🗑️ Menghapus sesi...");
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    console.log("✅ Sesi berhasil dihapus. Memulai ulang bot...");

    setTimeout(() => initializeClient(), 5000);

    res.json({ message: "✅ Client berhasil logout dan sesi dihapus." });
  } catch (error) {
    console.error("❌ Gagal logout:", error.message);
    res.status(500).json({ message: "❌ Gagal logout", error: error.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
});

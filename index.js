require("dotenv").config();

const { Client, GatewayIntentBits, Collection } = require("discord.js");
const express = require("express");
const cors = require("cors");

const client = new Client({
    intents: Object.values(GatewayIntentBits)
});

client.commands = new Collection();

// Bot istatistikleri global olarak tutalım
let botStats = {
    servers: 0,
    users: 0,
    commands: 50,
    uptime: 0,
    ping: 0,
    startTime: Date.now()
};

client.once("ready", () => {
    console.log(`${client.user.tag} aktif!`);
    
    // İstatistikleri güncelle
    updateStats();
    
    // Her 30 saniyede güncelle
    setInterval(updateStats, 30000);
    
    // Web sunucusunu başlat
    startWebServer();
});

function updateStats() {
    botStats.servers = client.guilds.cache.size;
    botStats.users = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
    botStats.ping = client.ws.ping;
    botStats.uptime = Math.floor((Date.now() - botStats.startTime) / 1000);
}

function startWebServer() {
    const app = express();
    
    app.use(cors());
    app.use(express.json());
    
    // Ana API endpoint - istatistikler
    app.get("/api/stats", (req, res) => {
        const totalUptime = botStats.uptime;
        const days = Math.floor(totalUptime / 86400);
        const hours = Math.floor((totalUptime % 86400) / 3600);
        const minutes = Math.floor((totalUptime % 3600) / 60);
        const seconds = totalUptime % 60;
        
        res.json({
            success: true,
            data: {
                servers: botStats.servers,
                users: botStats.users,
                commands: botStats.commands,
                ping: botStats.ping,
                uptime: botStats.uptime,
                uptimeFormatted: `${days}d ${hours}h ${minutes}m ${seconds}s`,
                status: "online",
                version: "4.2.1"
            }
        });
    });
    
    // Sağlık kontrolü endpoint'i
    app.get("/api/health", (req, res) => {
        res.json({
            success: true,
            status: "online",
            timestamp: new Date().toISOString()
        });
    });
    
    // Hata yönetimi
    app.use((req, res) => {
        res.status(404).json({
            success: false,
            message: "Endpoint bulunamadı"
        });
    });
    
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Web sunucu ${PORT} portunda çalışıyor!`);
        console.log(`Stats: http://localhost:${PORT}/api/stats`);
    });
}

client.login(process.env.TOKEN);

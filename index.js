require("dotenv").config();

const { Client, GatewayIntentBits, Collection, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder } = require("discord.js");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
    ]
});

client.commands = new Collection();

const PREFIX = '!';
const TOKEN = process.env.TOKEN;
const stoklar = new Map();

// ===================== BOT İSTATİSTİKLERİ =====================
let botStats = {
    servers: 0,
    users: 0,
    commands: 50,
    uptime: 0,
    ping: 0,
    startTime: Date.now()
};

// ===================== CONFIG (JSON dosyaları) =====================
const CONFIG_FILE = path.join(__dirname, 'config.json');
function configYukle() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}
function configKaydet(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ===================== ÇEKİLİŞ SİSTEMİ =====================
const cekilisKatilimcilar = new Map();

async function cekilisYap(guild) {
  const config = configYukle();
  const gc = config[guild.id]?.cekilis;
  if (!gc || !gc.kanalId || !gc.odul) return;

  const kanal = guild.channels.cache.get(gc.kanalId);
  if (!kanal) return;

  const katilimcilar = cekilisKatilimcilar.get(guild.id);
  if (!katilimcilar || katilimcilar.size === 0) {
    const embed = new EmbedBuilder()
      .setTitle('🎉 Çekiliş Sonucu')
      .setDescription('😔 Bu hafta kimse katılmadı, çekiliş iptal edildi!')
      .setColor('#FF4500').setTimestamp();
    return kanal.send({ embeds: [embed] });
  }

  const liste = Array.from(katilimcilar);
  const kazanan = liste[Math.floor(Math.random() * liste.length)];
  cekilisKatilimcilar.set(guild.id, new Set());

  const embed = new EmbedBuilder()
    .setTitle('🎊 ÇEKİLİŞ SONUCU!')
    .setDescription(`✨ **Tebrikler <@${kazanan}>!** ✨\n\n🏆 **Ödül:** ${gc.odul}\n👥 **Katılımcı Sayısı:** ${liste.length} kişi`)
    .setColor('#00CFFF')
    .addFields({ name: '🎯 Kazanan', value: `<@${kazanan}>`, inline: true })
    .setFooter({ text: 'DonutSMP Çekiliş Sistemi' }).setTimestamp();

  await kanal.send({ content: `🎉 @everyone`, embeds: [embed] });
}

function cekilisZamanlayici() {
  setInterval(async () => {
    const now = new Date();
    const gun = now.getDay();
    const saat = now.getHours();
    const dakika = now.getMinutes();
    if (gun === 1 && saat === 18 && dakika === 0) {
      for (const guild of client.guilds.cache.values()) {
        await cekilisYap(guild);
      }
    }
  }, 60 * 1000);
}

// ===================== SAYAÇ FONKSİYONU =====================
async function sayaclariGuncelle() {
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.members.fetch();
      const tumUyeler = guild.memberCount;
      const aktifUyeler = guild.members.cache.filter(m =>
        m.presence?.status === 'online' || m.presence?.status === 'idle' || m.presence?.status === 'dnd'
      ).size;

      let tumKanal = guild.channels.cache.find(c => c.name.startsWith('👥 Tüm Üye'));
      if (!tumKanal) {
        tumKanal = await guild.channels.create({
          name: `👥 Tüm Üye: ${tumUyeler}`,
          type: ChannelType.GuildVoice,
          permissionOverwrites: [{ id: guild.roles.everyone, deny: [PermissionsBitField.Flags.Connect], allow: [PermissionsBitField.Flags.ViewChannel] }]
        });
      } else { await tumKanal.setName(`👥 Tüm Üye: ${tumUyeler}`); }

      let aktifKanal = guild.channels.cache.find(c => c.name.startsWith('🟢 Aktif Üye'));
      if (!aktifKanal) {
        aktifKanal = await guild.channels.create({
          name: `🟢 Aktif Üye: ${aktifUyeler}`,
          type: ChannelType.GuildVoice,
          permissionOverwrites: [{ id: guild.roles.everyone, deny: [PermissionsBitField.Flags.Connect], allow: [PermissionsBitField.Flags.ViewChannel] }]
        });
      } else { await aktifKanal.setName(`🟢 Aktif Üye: ${aktifUyeler}`); }
    } catch (e) { console.error('Sayaç güncellenemedi:', e.message); }
  }
}

function updateStats() {
    botStats.servers = client.guilds.cache.size;
    botStats.users = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
    botStats.ping = client.ws.ping;
    botStats.uptime = Math.floor((Date.now() - botStats.startTime) / 1000);
}

// ===================== BOT HAZIR =====================
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} olarak giriş yapıldı!`);
  client.user.setActivity('DonutSMP | youtube.com/@06yyusuff', { type: 3 });
  await sayaclariGuncelle();
  setInterval(sayaclariGuncelle, 5 * 60 * 1000);
  cekilisZamanlayici();
  
  // İstatistikleri güncelle
  updateStats();
  setInterval(updateStats, 30000);
  
  // Web sunucusunu başlat
  startWebServer();
});

client.on('guildMemberAdd', () => sayaclariGuncelle());
client.on('guildMemberRemove', () => sayaclariGuncelle());

// ===================== TÜM KOMUTLAR =====================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // =================== YARDIM ===================
  if (command === 'yardim' || command === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📋 Bot Komutları')
      .setColor('#5865F2')
      .setThumbnail(client.user.displayAvatarURL())
      .addFields(
        { name: '🛡️ Moderasyon', value: '`!kick @kullanici` - Atar\n`!ban @kullanici` - Banlar\n`!unban <id>` - Ban kaldırır\n`!mute @kullanici` - Susturur\n`!unmute @kullanici` - Susturmayı kaldırır\n`!clear <sayı>` - Mesaj siler' },
        { name: '🎉 Eğlence', value: '`!zar` - Zar atar\n`!yazıtura` - Yazı tura\n`!8top <soru>` - 8-top\n`!avatar @kullanici` - Avatar\n`!sunucu` - Sunucu bilgisi\n`!kullanici @kullanici` - Kullanıcı bilgisi' },
        { name: '🛒 Stok Sistemi', value: '`!stokekle <item> <miktar> <satış> [alış]`\n`!stokguncelle <item> <miktar>`\n`!stoksil <item>`\n`!stok` - Stokları göster\n`!ilan` - İlan yayınla' },
        { name: '🛒 Pazar', value: '`!pazarkur` - Pazar paneli kur (admin)\n`!fiyatayarla Alış: 4.2m Satış: 5m` - Fiyat güncelle' },
        { name: '🤝 Aracı', value: '`!aracikur` - Aracı paneli kur (admin)' },
        { name: '🎉 Çekiliş', value: '`!cekiliskur` - Çekiliş paneli kur (admin)\n`!katil` - Çekilişe katıl' },
        { name: '📺 YouTube', value: '`!yayinkur` - YouTube bildirim paneli kur (admin)' },
        { name: '✅ Güven', value: '`!guven @kullanici` - Güvenilir Tüccar rolü ver (admin)' },
        { name: '📁 Schematic', value: '`!schemakur` - Schematic paneli kur (admin)' },
        { name: '🎫 Ticket', value: '`!ticketkur` - Ticket paneli (admin)\n`!kapat` - Ticket kapat' },
        { name: '📊 Bilgi', value: '`!ping` - Gecikme\n`!uptime` - Çalışma süresi' }
      )
      .setFooter({ text: 'Prefix: !' }).setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // =================== PING ===================
  if (command === 'ping') {
    const embed = new EmbedBuilder().setTitle('🏓 Pong!').setColor('#00FF00')
      .addFields(
        { name: 'Bot Gecikmesi', value: `${Date.now() - message.createdTimestamp}ms`, inline: true },
        { name: 'API Gecikmesi', value: `${Math.round(client.ws.ping)}ms`, inline: true }
      );
    return message.reply({ embeds: [embed] });
  }

  // =================== UPTIME ===================
  if (command === 'uptime') {
    const totalSeconds = Math.floor(botStats.uptime);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const embed = new EmbedBuilder()
      .setTitle('⏳ Bot Çalışma Süresi')
      .setColor('#00FF00')
      .addFields(
        { name: 'Uptime', value: `${days}g ${hours}s ${minutes}dk ${seconds}sn`, inline: true },
        { name: 'Status', value: '🟢 Online', inline: true }
      );
    return message.reply({ embeds: [embed] });
  }

  // =================== MERHABA (GÖREV TESPİT) ===================
  if (command === 'merhaba' || message.content.toLowerCase().includes('merhaba')) {
    const userXP = 100;
    const userMoney = 500;
    
    const embed = new EmbedBuilder()
      .setTitle('👋 Merhaba!')
      .setDescription(`Hoş geldin <@${message.author.id}>!\n\n✨ **Görev Tamamlandı: Merhaba De**\n➕ ${userXP} XP\n💰 ${userMoney} DonutSMP`)
      .setColor('#00FF00')
      .setTimestamp();
    
    return message.reply({ embeds: [embed] });
  }

  // =================== KICK ===================
  if (command === 'kick') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers)) 
      return message.reply('❌ Yeterli izniniz yok!');
    const user = message.mentions.first();
    if (!user) return message.reply('❌ Kullanıcı belirtiniz!');
    await user.kick();
    message.reply(`✅ ${user.username} sunucudan çıkarıldı!`);
  }

  // =================== BAN ===================
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers)) 
      return message.reply('❌ Yeterli izniniz yok!');
    const user = message.mentions.first();
    if (!user) return message.reply('❌ Kullanıcı belirtiniz!');
    await message.guild.bans.create(user);
    message.reply(`✅ ${user.username} sunucudan yasaklandı!`);
  }

  // =================== CLEAR ===================
  if (command === 'clear') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) 
      return message.reply('❌ Yeterli izniniz yok!');
    const amount = parseInt(args[0]) || 10;
    if (amount > 100) return message.reply('❌ Maksimum 100 mesaj silebilirsiniz!');
    await message.channel.bulkDelete(amount);
    message.reply(`✅ ${amount} mesaj silindi!`).then(m => setTimeout(() => m.delete(), 3000));
  }

  // =================== ZAR ===================
  if (command === 'zar') {
    const result = Math.floor(Math.random() * 6) + 1;
    message.reply(`🎲 ${message.author.username} ${result} attı!`);
  }

  // =================== YAZI TURA ===================
  if (command === 'yazıtura') {
    const result = Math.random() > 0.5 ? '🪙 Yazı' : '🪙 Tura';
    message.reply(`${message.author.username}: ${result}`);
  }

  // =================== AVATAR ===================
  if (command === 'avatar') {
    const user = message.mentions.first() || message.author;
    const embed = new EmbedBuilder()
      .setTitle(`👤 ${user.username}`)
      .setImage(user.displayAvatarURL({ size: 512 }))
      .setColor('#5865F2');
    message.reply({ embeds: [embed] });
  }

  // =================== SUNUCU BİLGİSİ ===================
  if (command === 'sunucu') {
    const embed = new EmbedBuilder()
      .setTitle(`📊 ${message.guild.name} Bilgisi`)
      .setColor('#5865F2')
      .addFields(
        { name: 'Üye Sayısı', value: `${message.guild.memberCount}`, inline: true },
        { name: 'Kanal Sayısı', value: `${message.guild.channels.cache.size}`, inline: true },
        { name: 'Rol Sayısı', value: `${message.guild.roles.cache.size}`, inline: true },
        { name: 'Sahip', value: `<@${message.guild.ownerId}>`, inline: true }
      )
      .setThumbnail(message.guild.iconURL())
      .setTimestamp();
    message.reply({ embeds: [embed] });
  }
});

// ===================== INTERACTION HANDLER =====================
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === 'araci_cagir') {
      await interaction.deferReply({ ephemeral: true });
      const guild = interaction.guild;
      const user = interaction.user;

      const mevcutAraci = guild.channels.cache.find(c => c.name === `araci-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`);
      if (mevcutAraci) return interaction.editReply({ content: `❌ Zaten açık bir aracı kanalın var! <#${mevcutAraci.id}>` });

      const araciRol = guild.roles.cache.find(r => r.name === 'Aracı');

      const permissionoverwrites = [
        { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: guild.members.me.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
      ];

      if (araciRol) {
        permissionoverwrites.push({ id: araciRol.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] });
      }

      const araciKanal = await guild.channels.create({
        name: `araci-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        type: ChannelType.GuildText,
        permissionOverwrites
      });

      const araciEmbed = new EmbedBuilder()
        .setTitle('🤝 Aracı Kanalı Açıldı!')
        .setDescription(`Merhaba <@${user.id}>! 👋\n\n⏳ **Biraz bekleyin, aracı gelecektir!**`)
        .setColor('#FFD700')
        .setTimestamp();

      const kapatRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('araci_kapat_btn').setLabel('🔒 Kanalı Kapat').setStyle(ButtonStyle.Danger)
      );

      await araciKanal.send({ content: `<@${user.id}>`, embeds: [araciEmbed], components: [kapatRow] });
      return interaction.editReply({ content: `✅ Aracı kanalın oluşturuldu! <#${araciKanal.id}>` });
    }

    if (interaction.customId === 'araci_kapat_btn' || interaction.customId === 'pazar_kapat_btn' || interaction.customId === 'ticket_kapat_btn') {
      const embed = new EmbedBuilder()
        .setTitle('🔒 Kanal Kapatılıyor')
        .setDescription(`<@${interaction.user.id}> tarafından kapatıldı.\n5 saniye içinde silinecek...`)
        .setColor('#FF4500');
      await interaction.reply({ embeds: [embed] });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }

    if (interaction.customId === 'ticket_ac') {
      await interaction.deferReply({ ephemeral: true });
      const guild = interaction.guild;
      const user = interaction.user;

      const mevcutTicket = guild.channels.cache.find(c => c.name === `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`);
      if (mevcutTicket) return interaction.editReply({ content: `❌ Zaten açık bir ticketin var! <#${mevcutTicket.id}>` });

      const ticketKanal = await guild.channels.create({
        name: `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: guild.members.me.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
        ]
      });

      const ticketEmbed = new EmbedBuilder()
        .setTitle(`🎫 Ticket — ${user.username}`)
        .setDescription(`Merhaba <@${user.id}>! 👋\n\nTicketin oluşturuldu.`)
        .setColor('#5865F2')
        .setTimestamp();

      const kapatRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_kapat_btn').setLabel('🔒 Ticketi Kapat').setStyle(ButtonStyle.Danger)
      );

      await ticketKanal.send({ content: `<@${user.id}>`, embeds: [ticketEmbed], components: [kapatRow] });
      return interaction.editReply({ content: `✅ Ticketin oluşturuldu! <#${ticketKanal.id}>` });
    }
  }
});

// ===================== WEB SERVER =====================
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
    
    // Sağlık kontrolü
    app.get("/api/health", (req, res) => {
        res.json({
            success: true,
            status: "online",
            timestamp: new Date().toISOString()
        });
    });
    
    app.use((req, res) => {
        res.status(404).json({
            success: false,
            message: "Endpoint bulunamadı"
        });
    });
    
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`✅ Web sunucu ${PORT} portunda çalışıyor!`);
        console.log(`📊 Stats: http://localhost:${PORT}/api/stats`);
    });
}

client.login(TOKEN);

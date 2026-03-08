require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

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

const PREFIX = '06';
const TOKEN = process.env.TOKEN;
const stoklar = new Map();

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
const cekilisKatilimcilar = new Map(); // guildId -> Set(userId)

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
    const gun = now.getDay(); // 1 = Pazartesi
    const saat = now.getHours();
    const dakika = now.getMinutes();
    if (gun === 1 && saat === 18 && dakika === 0) {
      for (const guild of client.guilds.cache.values()) {
        await cekilisYap(guild);
      }
    }
  }, 60 * 1000); // her dakika kontrol
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

// ===================== BOT HAZIR =====================
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} olarak giriş yapıldı!`);
  client.user.setActivity('youtube.com/@06yyusuff', { type: 3 });
  await sayaclariGuncelle();
  setInterval(sayaclariGuncelle, 5 * 60 * 1000);
  cekilisZamanlayici();
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
    const totalSeconds = Math.floor(process.uptime());
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const embed = new EmbedBuilder().setTitle('⏱️ Uptime').setColor('#FFA500')
      .setDescription(`${hours} saat, ${minutes} dakika, ${seconds} saniye`);
    return message.reply({ embeds: [embed] });
  }

  // =================== SUNUCU ===================
  if (command === 'sunucu') {
    const guild = message.guild;
    const embed = new EmbedBuilder().setTitle(`📊 ${guild.name} Bilgileri`).setColor('#5865F2')
      .setThumbnail(guild.iconURL())
      .addFields(
        { name: 'Üye Sayısı', value: `${guild.memberCount}`, inline: true },
        { name: 'Kanal Sayısı', value: `${guild.channels.cache.size}`, inline: true },
        { name: 'Rol Sayısı', value: `${guild.roles.cache.size}`, inline: true },
        { name: 'Kurucu', value: `<@${guild.ownerId}>`, inline: true },
        { name: 'Oluşturulma', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true }
      ).setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // =================== KULLANICI ===================
  if (command === 'kullanici') {
    const target = message.mentions.users.first() || message.author;
    const member = message.guild.members.cache.get(target.id);
    const embed = new EmbedBuilder().setTitle(`👤 ${target.username} Bilgileri`).setColor('#5865F2')
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'Kullanıcı Adı', value: target.username, inline: true },
        { name: 'ID', value: target.id, inline: true },
        { name: 'Hesap Oluşturma', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: true },
        { name: 'Sunucuya Katılma', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Bilinmiyor', inline: true }
      ).setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // =================== AVATAR ===================
  if (command === 'avatar') {
    const target = message.mentions.users.first() || message.author;
    const embed = new EmbedBuilder().setTitle(`🖼️ ${target.username} Avatarı`).setColor('#5865F2')
      .setImage(target.displayAvatarURL({ size: 512 }));
    return message.reply({ embeds: [embed] });
  }

  // =================== ZAR ===================
  if (command === 'zar') {
    const result = Math.floor(Math.random() * 6) + 1;
    const faces = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣'];
    const embed = new EmbedBuilder().setTitle('🎲 Zar Atıldı!').setColor('#FF6B6B')
      .setDescription(`${faces[result - 1]} **${result}** geldi!`);
    return message.reply({ embeds: [embed] });
  }

  // =================== YAZI TURA ===================
  if (command === 'yazıtura' || command === 'yazitura') {
    const result = Math.random() < 0.5 ? '🪙 Yazı' : '🪙 Tura';
    const embed = new EmbedBuilder().setTitle('🪙 Yazı Tura').setColor('#FFD700')
      .setDescription(`**${result}** geldi!`);
    return message.reply({ embeds: [embed] });
  }

  // =================== 8TOP ===================
  if (command === '8top') {
    const cevaplar = ['Kesinlikle evet! ✅', 'Hayır, hiç sanmıyorum ❌', 'Belki... 🤔', 'Evet! 💯', 'Şüpheliyim 😐', 'Kesinlikle hayır! 🚫', 'Çok olası! 🌟', 'Yarın tekrar sor 📅', 'Sihirli top bulanık görüyor... 🔮'];
    if (!args.length) return message.reply('❌ Bir soru sor! Örnek: `!8top Bugün şansım var mı?`');
    const embed = new EmbedBuilder().setTitle('🎱 8-Top').setColor('#1a1a2e')
      .addFields({ name: '❓ Soru', value: args.join(' ') }, { name: '🔮 Cevap', value: cevaplar[Math.floor(Math.random() * cevaplar.length)] });
    return message.reply({ embeds: [embed] });
  }

  // =================== KICK ===================
  if (command === 'kick') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers))
      return message.reply('❌ **Üyeleri At** yetkisine sahip olmalısın!');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Kullanıcı etiketle!');
    if (!target.kickable) return message.reply('❌ Bu kullanıcıyı atamıyorum!');
    const sebep = args.slice(1).join(' ') || 'Sebep belirtilmedi';
    await target.kick(sebep);
    const embed = new EmbedBuilder().setTitle('👢 Kullanıcı Atıldı').setColor('#FF4500')
      .addFields({ name: 'Kullanıcı', value: `${target.user.tag}`, inline: true }, { name: 'Sebep', value: sebep }).setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // =================== BAN ===================
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
      return message.reply('❌ **Üyeleri Yasakla** yetkisine sahip olmalısın!');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Kullanıcı etiketle!');
    if (!target.bannable) return message.reply('❌ Bu kullanıcıyı banlayamıyorum!');
    const sebep = args.slice(1).join(' ') || 'Sebep belirtilmedi';
    await target.ban({ reason: sebep });
    const embed = new EmbedBuilder().setTitle('🔨 Kullanıcı Banlandı').setColor('#8B0000')
      .addFields({ name: 'Kullanıcı', value: `${target.user.tag}`, inline: true }, { name: 'Sebep', value: sebep }).setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // =================== UNBAN ===================
  if (command === 'unban') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
      return message.reply('❌ **Üyeleri Yasakla** yetkisine sahip olmalısın!');
    const userId = args[0];
    if (!userId) return message.reply('❌ Kullanım: `!unban 123456789`');
    try {
      await message.guild.members.unban(userId);
      return message.reply(`✅ ID: ${userId} olan kullanıcının banı kaldırıldı.`);
    } catch { return message.reply('❌ Böyle bir banlı kullanıcı bulunamadı!'); }
  }

  // =================== MUTE ===================
  if (command === 'mute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ **Üyeleri Sustur** yetkisine sahip olmalısın!');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Kullanıcı etiketle!');
    await target.timeout(10 * 60 * 1000, 'Moderatör tarafından susturuldu');
    const embed = new EmbedBuilder().setTitle('🔇 Kullanıcı Susturuldu').setColor('#FFA500')
      .addFields({ name: 'Kullanıcı', value: `${target.user.tag}`, inline: true }, { name: 'Süre', value: '10 dakika', inline: true }).setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // =================== UNMUTE ===================
  if (command === 'unmute') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
      return message.reply('❌ **Üyeleri Sustur** yetkisine sahip olmalısın!');
    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Kullanıcı etiketle!');
    await target.timeout(null);
    return message.reply(`✅ ${target.user.tag} artık konuşabilir.`);
  }

  // =================== CLEAR ===================
  if (command === 'clear' || command === 'temizle') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ **Mesajları Yönet** yetkisine sahip olmalısın!');
    const amount = parseInt(args[0]);
    if (isNaN(amount) || amount < 1 || amount > 100) return message.reply('❌ 1-100 arası bir sayı gir!');
    await message.channel.bulkDelete(amount + 1, true);
    const msg = await message.channel.send(`✅ **${amount}** mesaj silindi!`);
    setTimeout(() => msg.delete().catch(() => {}), 3000);
  }

  // =================== STOK EKLE ===================
  if (command === 'stokekle') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ Yetkin yok!');
    const [isim, miktar, satisFiyat, alisFiyat] = args;
    if (!isim || !miktar || !satisFiyat)
      return message.reply('❌ Kullanım: `!stokekle <item> <miktar> <satış> [alış]`\nÖrnek: `!stokekle spawner 64 1000 800`');
    stoklar.set(isim.toLowerCase(), { isim, miktar: parseInt(miktar), satisFiyat: parseInt(satisFiyat), alisFiyat: alisFiyat ? parseInt(alisFiyat) : null });
    const embed = new EmbedBuilder().setTitle('✅ Stok Eklendi').setColor('#00FF00')
      .addFields(
        { name: '📦 Item', value: isim, inline: true },
        { name: '🔢 Miktar', value: miktar, inline: true },
        { name: '💰 Satış', value: `${satisFiyat} Donutsmp Parası`, inline: true },
        { name: '💵 Alış', value: alisFiyat ? `${alisFiyat} 
` : 'Yok', inline: true }
      );
    return message.reply({ embeds: [embed] });
  }

  // =================== STOK SİL ===================
  if (command === 'stoksil') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ Yetkin yok!');
    const isim = args[0];
    if (!isim) return message.reply('❌ Kullanım: `!stoksil <item>`');
    if (!stoklar.has(isim.toLowerCase())) return message.reply('❌ Bu item stokta yok!');
    stoklar.delete(isim.toLowerCase());
    return message.reply(`✅ **${isim}** stoktan silindi!`);
  }

  // =================== STOK GÜNCELLE ===================
  if (command === 'stokguncelle') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ Yetkin yok!');
    const [isim, miktar] = args;
    if (!isim || !miktar) return message.reply('❌ Kullanım: `!stokguncelle <item> <yeni miktar>`');
    if (!stoklar.has(isim.toLowerCase())) return message.reply('❌ Bu item stokta yok!');
    const stok = stoklar.get(isim.toLowerCase());
    stok.miktar = parseInt(miktar);
    stoklar.set(isim.toLowerCase(), stok);
    return message.reply(`✅ **${isim}** stoğu **${miktar}** olarak güncellendi!`);
  }

  // =================== STOK LİSTESİ ===================
  if (command === 'stok') {
    if (stoklar.size === 0) return message.reply('❌ Stokta item yok! `!stokekle` ile ekle.');
    const embed = new EmbedBuilder().setTitle('🏪 Mevcut Stoklar').setColor('#FFD700')
      .setDescription('Aşağıdaki itemleri satın alabilir veya satabilirsiniz!')
      .setFooter({ text: 'Satın almak için yetkililere ulaşın' }).setTimestamp();
    for (const [, stok] of stoklar) {
      embed.addFields({ name: `📦 ${stok.isim}`, value: `🔢 Miktar: **${stok.miktar}**\n💰 Satış: **${stok.satisFiyat} Donutsmp Parası**${stok.alisFiyat ? `\n💵 Alış: **${stok.alisFiyat} Donutsmp Parası**` : ''}`, inline: true });
    }
    return message.reply({ embeds: [embed] });
  }

  // =================== İLAN ===================
  if (command === 'ilan') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages))
      return message.reply('❌ Yetkin yok!');
    if (stoklar.size === 0) return message.reply('❌ Stokta item yok! Önce `!stokekle` ile ekle.');
    let stokListesi = '';
    for (const [, stok] of stoklar) {
      stokListesi += `> 📦 **${stok.isim}** — ${stok.miktar} adet\n`;
      stokListesi += `> 💰 Satış: **${stok.satisFiyat} Donutsmp Parası**`;
      if (stok.alisFiyat) stokListesi += ` | 💵 Alış: **${stok.alisFiyat} Donutsmp Parası**`;
      stokListesi += '\n\n';
    }
    const embed = new EmbedBuilder().setTitle('🛒 DonutSMP — Spawner Dükkanı')
      .setDescription(`${stokListesi}📩 Satın almak veya satmak için <@${message.author.id}> ile iletişime geçin!`)
      .setColor('#FF6B00')
      .addFields(
        { name: '⚡ Hızlı Teslimat', value: 'Anında teslim!', inline: true },
        { name: '🔒 Güvenli Alışveriş', value: 'Güvenli işlem!', inline: true }
      )
      .setFooter({ text: 'DonutSMP Spawner Dükkanı • Stok değişebilir' }).setTimestamp();
    return message.channel.send({ embeds: [embed] });
  }

  // =================== ÖDÜL AYARLA ===================
  if (command === 'odul') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Yönetici yetkisi gerekli!');
    const odul = args.join(' ');
    if (!odul) return message.reply('❌ Kullanım: `!odul <ödül adı>`');
    const config = configYukle();
    if (!config[message.guild.id]) config[message.guild.id] = {};
    if (!config[message.guild.id].cekilis) config[message.guild.id].cekilis = {};
    config[message.guild.id].cekilis.odul = odul;
    configKaydet(config);
    return message.reply(`✅ Çekiliş ödülü **${odul}** olarak ayarlandı!`);
  }

  // =================== ÇEKİLİŞ KUR ===================
  if (command === 'cekiliskur') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Yönetici yetkisi gerekli!');

    const embed = new EmbedBuilder()
      .setTitle('🎉 Çekiliş Sistemi Kurulumu')
      .setDescription('Aşağıdaki butonlarla çekiliş ayarlarını yapılandır.')
      .setColor('#00CFFF')
      .addFields(
        { name: '📅 Çekiliş Günü', value: 'Her **Pazartesi** saat **18:00**', inline: true },
        { name: '📢 Kanal', value: 'Ayarla butonuna bas', inline: true },
        { name: '🏆 Ödül', value: 'Ayarla butonuna bas', inline: true }
      )
      .setFooter({ text: 'DonutSMP Çekiliş Sistemi' }).setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cekilis_kanal_ayarla').setLabel('📢 Bu Kanalı Seç').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('cekilis_odul_ayarla').setLabel('🏆 Ödül Yaz').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('cekilis_panel_gonder').setLabel('🎉 Paneli Yayınla').setStyle(ButtonStyle.Success)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    return message.reply('✅ Çekiliş kurulum paneli oluşturuldu!');
  }

  // =================== ÇEKİLİŞE KATIL ===================
  if (command === 'katil') {
    const config = configYukle();
    const gc = config[message.guild.id]?.cekilis;
    if (!gc || !gc.kanalId) return message.reply('❌ Henüz bir çekiliş kurulmadı!');
    if (!cekilisKatilimcilar.has(message.guild.id)) cekilisKatilimcilar.set(message.guild.id, new Set());
    const katilimcilar = cekilisKatilimcilar.get(message.guild.id);
    if (katilimcilar.has(message.author.id)) return message.reply('❌ Zaten çekilişe katıldın!');
    katilimcilar.add(message.author.id);
    const embed = new EmbedBuilder()
      .setTitle('🎉 Çekilişe Katıldın!')
      .setDescription(`<@${message.author.id}> çekilişe katıldı!\n🏆 **Ödül:** ${gc.odul || 'Belirtilmedi'}\n👥 **Toplam Katılımcı:** ${katilimcilar.size}`)
      .setColor('#00CFFF').setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // =================== YAYIN KUR ===================
  if (command === 'yayinkur') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Yönetici yetkisi gerekli!');

    const embed = new EmbedBuilder()
      .setTitle('📺 YouTube Bildirim Sistemi')
      .setDescription('Bu kanal YouTube yayın/video bildirim kanalı olarak ayarlanacak.\n\nYeni video/yayın duyurusu yapmak için:\n`!yayin <başlık> | <link>`\nÖrnek: `!yayin Yeni Video Çıktı! | https://youtu.be/xxxxx`')
      .setColor('#FF0000')
      .addFields(
        { name: '📢 Kanal', value: message.channel.toString(), inline: true },
        { name: '👤 Kuran', value: message.author.toString(), inline: true }
      )
      .setFooter({ text: 'DonutSMP YouTube Bildirim Sistemi' }).setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('yayin_kanal_ayarla').setLabel('📢 Bu Kanalı Seç').setStyle(ButtonStyle.Danger)
    );

    const config = configYukle();
    if (!config[message.guild.id]) config[message.guild.id] = {};
    config[message.guild.id].yayinKanalId = message.channel.id;
    configKaydet(config);

    await message.channel.send({ embeds: [embed], components: [row] });
    return message.reply('✅ YouTube bildirim paneli oluşturuldu!');
  }

  // =================== YAYIN DUYUR ===================
  if (command === 'yayin') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Yönetici yetkisi gerekli!');

    const config = configYukle();
    const kanalId = config[message.guild.id]?.yayinKanalId;
    if (!kanalId) return message.reply('❌ Önce `!yayinkur` ile kanal ayarla!');

    const kanal = message.guild.channels.cache.get(kanalId);
    if (!kanal) return message.reply('❌ Bildirim kanalı bulunamadı!');

    const parcalar = args.join(' ').split('|');
    const baslik = parcalar[0]?.trim();
    const link = parcalar[1]?.trim();

    if (!baslik || !link) return message.reply('❌ Kullanım: `!yayin <başlık> | <link>`');

    const embed = new EmbedBuilder()
      .setTitle('📺 YENİ VİDEO / YAYIN!')
      .setDescription(`🎬 **${baslik}**\n\n🔗 ${link}`)
      .setColor('#FF0000')
      .setThumbnail(message.guild.iconURL())
      .addFields(
        { name: '👤 Kanal', value: 'DonutSMP', inline: true },
        { name: '🔔 Bildirim', value: 'Yeni içerik yayınlandı!', inline: true }
      )
      .setFooter({ text: 'DonutSMP • YouTube' }).setTimestamp();

    await kanal.send({ content: '@everyone 🔔 Yeni içerik yayınlandı!', embeds: [embed] });
    return message.reply('✅ Bildirim gönderildi!');
  }

  // =================== GÜVEN ROL ===================
  if (command === 'guven') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Yönetici yetkisi gerekli!');

    const target = message.mentions.members.first();
    if (!target) return message.reply('❌ Kullanım: `!guven @kullanici`');

    const rolAdi = '✅ ┃ ticaret-yapıldı';
    let rol = message.guild.roles.cache.find(r => r.name === rolAdi);

    if (!rol) {
      rol = await message.guild.roles.create({
        name: rolAdi,
        color: '#00FF7F',
        reason: 'Güvenilir Tüccar rolü otomatik oluşturuldu'
      });
    }

    if (target.roles.cache.has(rol.id)) {
      await target.roles.remove(rol);
      const embed = new EmbedBuilder()
        .setTitle('❌ Güven Rolü Alındı')
        .setDescription(`<@${target.id}> kullanıcısından **${rolAdi}** rolü alındı.`)
        .setColor('#FF4500').setTimestamp();
      return message.reply({ embeds: [embed] });
    }

    await target.roles.add(rol);
    const embed = new EmbedBuilder()
      .setTitle('✅ Güvenilir Tüccar!')
      .setDescription(`<@${target.id}> artık güvenilir bir tüccar! 🤝\n\n> Bu kişiyle güvenle ticaret yapabilirsiniz.`)
      .setColor('#00FF7F')
      .addFields(
        { name: '👤 Kullanıcı', value: `<@${target.id}>`, inline: true },
        { name: '🏷️ Rol', value: rolAdi, inline: true },
        { name: '👮 Veren', value: `<@${message.author.id}>`, inline: true }
      )
      .setFooter({ text: 'DonutSMP Ticaret Sistemi' }).setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // =================== PAZAR KUR ===================
  if (command === 'pazarkur') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Yönetici yetkisi gerekli!');

    const config = configYukle();
    if (!config[message.guild.id]) config[message.guild.id] = {};
    if (!config[message.guild.id].pazar) {
      config[message.guild.id].pazar = {
        spawner: { alis: '4.2M', satis: '5M' }
      };
      configKaydet(config);
    }

    const pazar = config[message.guild.id].pazar;

    const menu = new StringSelectMenuBuilder()
      .setCustomId('pazar_kategori')
      .setPlaceholder('🛒 Bir kategori seç...')
      .addOptions([
        { label: '💀 Spawner Al/Sat', description: `Alış: ${pazar.spawner.alis} | Satış: ${pazar.spawner.satis}`, value: 'spawner', emoji: '💀' }
      ]);

    const row = new ActionRowBuilder().addComponents(menu);

    const embed = new EmbedBuilder()
      .setTitle('💀🔥 SPAWNER MARKET 💀🔥')
      .setDescription('Aşağıdan işlem yapmak istediğin kategoriyi seç!')
      .setColor('#FF6B00')
      .addFields(
        { name: '🟢 BİZE SATMAK İSTİYORSAN (Sen satarsın)', value: `> Alış fiyatı: **${pazar.spawner.alis}** / tanesi`, inline: false },
        { name: '🔴 BİZDEN ALMAK İSTİYORSAN (Sen alırsın)', value: `> Satış fiyatı: **${pazar.spawner.satis}** / tanesi`, inline: false },
        { name: '✅ Minimum', value: '3 spawner minimum', inline: true },
        { name: 'ℹ️ Bilgi', value: 'Fiyatlar değişebilir', inline: true }
      )
      .setFooter({ text: 'DonutSMP Spawner Market' })
      .setTimestamp();

    await message.channel.send({ embeds: [embed], components: [row] });
    return message.reply('✅ Pazar paneli oluşturuldu!');
  }

  // =================== FİYAT AYARLA ===================
  if (command === 'fiyatayarla') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Yönetici yetkisi gerekli!');

    const alisIndex = args.findIndex(a => a.toLowerCase() === 'alış:' || a.toLowerCase() === 'alis:');
    const satisIndex = args.findIndex(a => a.toLowerCase() === 'satış:' || a.toLowerCase() === 'satis:');

    if (alisIndex === -1 || satisIndex === -1)
      return message.reply('❌ Kullanım: `!fiyatayarla Alış: 4.2m Satış: 5m`');

    const alis = args[alisIndex + 1];
    const satis = args[satisIndex + 1];

    if (!alis || !satis) return message.reply('❌ Kullanım: `!fiyatayarla Alış: 4.2m Satış: 5m`');

    const config = configYukle();
    if (!config[message.guild.id]) config[message.guild.id] = {};
    if (!config[message.guild.id].pazar) config[message.guild.id].pazar = {};
    config[message.guild.id].pazar.spawner = { alis: alis.toUpperCase(), satis: satis.toUpperCase() };
    configKaydet(config);

    const embed = new EmbedBuilder()
      .setTitle('✅ Fiyatlar Güncellendi!')
      .setColor('#00FF00')
      .addFields(
        { name: '🟢 Alış (Bizden alırsın)', value: alis.toUpperCase(), inline: true },
        { name: '🔴 Satış (Bize satarsın)', value: satis.toUpperCase(), inline: true }
      )
      .setFooter({ text: 'Paneli yenilemek için !pazarkur komutunu tekrar kullan' })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // =================== ARACI KUR ===================
  if (command === 'aracikur') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Yönetici yetkisi gerekli!');

    const embed = new EmbedBuilder()
      .setTitle('🤝 DonutSMP — Aracı Sistemi')
      .setDescription('> Güvenli alışveriş için aracı kullanabilirsiniz!\n\n**📋 Aracı Kuralları:**\n> 💰 İşlem tutarından **%5 pay** alınır\n> ✅ Aracı her iki tarafı da korur\n> ⚡ Hızlı ve güvenli işlem\n> 🔒 Dolandırıcılığa karşı güvence\n\n**Aracı çağırmak için aşağıdaki butona bas!**')
      .setColor('#FFD700')
      .setFooter({ text: 'DonutSMP Aracı Sistemi • Güvenli Ticaret' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('araci_cagir').setLabel('🤝 Aracı Çağır').setStyle(ButtonStyle.Success)
    );

    await message.channel.send({ embeds: [embed], components: [row] });
    return message.reply('✅ Aracı paneli oluşturuldu!');
  }

  // =================== SCHEMATİC KUR ===================
  if (command === 'schemakur') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Yönetici yetkisi gerekli!');

    const schemaDir = path.join(__dirname, 'schematics');
    if (!fs.existsSync(schemaDir)) fs.mkdirSync(schemaDir);

    const dosyalar = fs.readdirSync(schemaDir).filter(f => f.endsWith('.litematic'));
    if (dosyalar.length === 0)
      return message.reply('❌ `schematics/` klasöründe hiç `.litematic` dosyası yok! Önce dosyaları ekle.');

    const options = dosyalar.map(dosya => ({
      label: dosya.replace('.litematic', '').substring(0, 25),
      description: dosya.substring(0, 50),
      value: dosya,
      emoji: '📐'
    }));

    const menu = new StringSelectMenuBuilder()
      .setCustomId('schema_sec')
      .setPlaceholder('📐 Bir schematic seç...')
      .addOptions(options);

    const row = new ActionRowBuilder().addComponents(menu);

    const embed = new EmbedBuilder()
      .setTitle('📐 DonutSMP — Schematic Arşivi')
      .setDescription('Aşağıdaki menüden indirmek istediğin schematic\'i seç.\n✅ Seçim **sadece sana** görünür!')
      .setColor('#FF6B00')
      .addFields({ name: '📦 Mevcut Schematic Sayısı', value: `${dosyalar.length} adet`, inline: true })
      .setFooter({ text: 'DonutSMP Schematic Sistemi' })
      .setTimestamp();

    await message.channel.send({ embeds: [embed], components: [row] });
    return message.reply('✅ Schematic paneli oluşturuldu!');
  }

  // =================== TİCKET KUR ===================
  if (command === 'ticketkur') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('❌ Yönetici yetkisi gerekli!');
    let kategori = message.guild.channels.cache.find(c => c.name === '🎫 Ticketlar' && c.type === ChannelType.GuildCategory);
    if (!kategori) {
      kategori = await message.guild.channels.create({
        name: '🎫 Ticketlar', type: ChannelType.GuildCategory,
        permissionOverwrites: [{ id: message.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] }]
      });
    }
    const embed = new EmbedBuilder().setTitle('🎫 Destek Sistemi')
      .setDescription('Yardım almak için aşağıdaki butona tıklayarak ticket açabilirsiniz.\n\n> 📌 Ticket açmadan önce sorununuzu hazır edin\n> 🚫 Gereksiz ticket açmayın\n> ⏰ Ekibimiz en kısa sürede size dönecek')
      .setColor('#5865F2').setFooter({ text: 'Destek Sistemi • Ticket Aç' }).setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_ac').setLabel('🎫 Ticket Aç').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket_bilgi').setLabel('ℹ️ Bilgi').setStyle(ButtonStyle.Secondary)
    );
    await message.channel.send({ embeds: [embed], components: [row] });
    return message.reply('✅ Ticket paneli oluşturuldu!');
  }

  // =================== TİCKET KAPAT ===================
  if (command === 'ticketkapat' || command === 'kapat') {
    if (!message.channel.name.startsWith('ticket-'))
      return message.reply('❌ Bu komut sadece ticket kanallarında kullanılabilir!');
    const embed = new EmbedBuilder().setTitle('🔒 Ticket Kapatılıyor').setDescription('5 saniye içinde silinecek...').setColor('#FF4500');
    await message.reply({ embeds: [embed] });
    setTimeout(() => message.channel.delete().catch(() => {}), 5000);
  }
});

// ===================== BUTON & MENÜ OLAYLARI =====================
client.on('interactionCreate', async (interaction) => {

  // =================== ÇEKİLİŞ BUTONLARI ===================
  if (interaction.customId === 'cekilis_kanal_ayarla') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: '❌ Yetkin yok!', ephemeral: true });
    const config = configYukle();
    if (!config[interaction.guild.id]) config[interaction.guild.id] = {};
    if (!config[interaction.guild.id].cekilis) config[interaction.guild.id].cekilis = {};
    config[interaction.guild.id].cekilis.kanalId = interaction.channel.id;
    configKaydet(config);
    return interaction.reply({ content: `✅ Çekiliş kanalı **${interaction.channel.name}** olarak ayarlandı!`, ephemeral: true });
  }

  if (interaction.customId === 'cekilis_odul_ayarla') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: '❌ Yetkin yok!', ephemeral: true });
    await interaction.reply({ content: '🏆 Ödülü yazmak için `!odul <ödül adı>` komutunu kullan!\nÖrnek: `!odul 1000 Donutsmp Parası`', ephemeral: true });
  }

  if (interaction.customId === 'cekilis_panel_gonder') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: '❌ Yetkin yok!', ephemeral: true });
    const config = configYukle();
    const gc = config[interaction.guild.id]?.cekilis;
    if (!gc?.kanalId) return interaction.reply({ content: '❌ Önce kanalı ayarla!', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle('🎉 HAFTALIK ÇEKİLİŞ!')
      .setDescription(`Her **Pazartesi 18:00**'de kazanan belli oluyor!\n\n🏆 **Ödül:** ${gc.odul || 'Yakında açıklanacak'}\n\n✅ Katılmak için aşağıdaki butona bas veya \`!katil\` yaz!`)
      .setColor('#00CFFF')
      .addFields(
        { name: '📅 Çekiliş Günü', value: 'Her Pazartesi', inline: true },
        { name: '⏰ Saat', value: '18:00', inline: true },
        { name: '👥 Katılımcılar', value: '0 kişi', inline: true }
      )
      .setFooter({ text: 'DonutSMP Çekiliş Sistemi' }).setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cekilis_katil_btn').setLabel('🎉 Katıl!').setStyle(ButtonStyle.Primary)
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: '✅ Çekiliş paneli yayınlandı!', ephemeral: true });
  }

  if (interaction.customId === 'cekilis_katil_btn') {
    const config = configYukle();
    const gc = config[interaction.guild.id]?.cekilis;
    if (!gc) return interaction.reply({ content: '❌ Çekiliş sistemi ayarlanmamış!', ephemeral: true });
    if (!cekilisKatilimcilar.has(interaction.guild.id)) cekilisKatilimcilar.set(interaction.guild.id, new Set());
    const katilimcilar = cekilisKatilimcilar.get(interaction.guild.id);
    if (katilimcilar.has(interaction.user.id))
      return interaction.reply({ content: '❌ Zaten çekilişe katıldın!', ephemeral: true });
    katilimcilar.add(interaction.user.id);
    return interaction.reply({ content: `✅ Çekilişe katıldın! 🎉 Toplam **${katilimcilar.size}** katılımcı var. Bol şans!`, ephemeral: true });
  }

  if (interaction.customId === 'yayin_kanal_ayarla') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: '❌ Yetkin yok!', ephemeral: true });
    const config = configYukle();
    if (!config[interaction.guild.id]) config[interaction.guild.id] = {};
    config[interaction.guild.id].yayinKanalId = interaction.channel.id;
    configKaydet(config);
    return interaction.reply({ content: `✅ YouTube bildirim kanalı **${interaction.channel.name}** olarak ayarlandı!\n\nDuyuru yapmak için: \`!yayin <başlık> | <link>\``, ephemeral: true });
  }

  // =================== PAZAR KATEGORİ ===================
  if (interaction.isStringSelectMenu() && interaction.customId === 'pazar_kategori') {
    await interaction.deferReply({ ephemeral: true });
    const guild = interaction.guild;
    const user = interaction.user;
    const secim = interaction.values[0];

    const mevcutKanal = guild.channels.cache.find(c => c.name === `pazar-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`);
    if (mevcutKanal) return interaction.editReply({ content: `❌ Zaten açık bir pazar kanalın var! <#${mevcutKanal.id}>` });

    const config = configYukle();
    const pazar = config[guild.id]?.pazar?.spawner || { alis: '4.2M', satis: '5M' };

    const pazarKanal = await guild.channels.create({
      name: `pazar-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
        { id: guild.members.me.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
      ]
    });

    const embed = new EmbedBuilder()
      .setTitle(`💀 Spawner İşlemi — ${user.username}`)
      .setDescription(`Merhaba <@${user.id}>! 👋\n\nİşlem talebiniz alındı. Yetkilimiz en kısa sürede size dönecek!\n\n> Ne almak/satmak istediğinizi ve miktarı belirtin.`)
      .setColor('#FF6B00')
      .addFields(
        { name: '🟢 Alış Fiyatı (Bize satarsın)', value: `**${pazar.alis}** / stack`, inline: true },
        { name: '🔴 Satış Fiyatı (Bizden alırsın)', value: `**${pazar.satis}** / stack`, inline: true },
        { name: '👤 Açan', value: `<@${user.id}>`, inline: true },
        { name: '📅 Tarih', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
      )
      .setFooter({ text: 'DonutSMP Spawner Market' })
      .setTimestamp();

    const kapatRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('pazar_kapat_btn').setLabel('🔒 Kanalı Kapat').setStyle(ButtonStyle.Danger)
    );

    await pazarKanal.send({ content: `<@${user.id}>`, embeds: [embed], components: [kapatRow] });
    return interaction.editReply({ content: `✅ Pazar kanalın oluşturuldu! <#${pazarKanal.id}>` });
  }

  // =================== SCHEMATİC MENÜ ===================
  if (interaction.isStringSelectMenu() && interaction.customId === 'schema_sec') {
    const secilenDosya = interaction.values[0];
    const dosyaYolu = path.join(__dirname, 'schematics', secilenDosya);

    if (!fs.existsSync(dosyaYolu))
      return interaction.reply({ content: '❌ Dosya bulunamadı! Yöneticiye haber ver.', ephemeral: true });

    const embed = new EmbedBuilder()
      .setTitle('📐 Schematic İndirildi!')
      .setDescription(`**${secilenDosya.replace('.litematic', '')}** dosyası gönderiliyor...`)
      .setColor('#00FF00')
      .addFields(
        { name: '📁 Dosya', value: secilenDosya, inline: true },
        { name: '👤 İsteyen', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setFooter({ text: 'Dosyayı .minecraft/schematics klasörüne koy!' })
      .setTimestamp();

    return interaction.reply({
      embeds: [embed],
      files: [{ attachment: dosyaYolu, name: secilenDosya }],
      ephemeral: true
    });
  }

  if (!interaction.isButton()) return;

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
      .setDescription(`Merhaba <@${user.id}>! 👋\n\n⏳ **Biraz bekleyin, aracı gelecektir!**\n\n> Lütfen işlem detaylarını (ne alınıp satılacak, tutar vb.) buraya yazın.\n> Aracımız en kısa sürede size katılacaktır.`)
      .setColor('#FFD700')
      .addFields(
        { name: '👤 Açan', value: `<@${user.id}>`, inline: true },
        { name: '📅 Tarih', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
        { name: '💰 Komisyon', value: 'İşlem tutarının **%5**\'i', inline: true }
      )
      .setFooter({ text: 'Kanalı kapatmak için aşağıdaki butona bas' })
      .setTimestamp();

    const kapatRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('araci_kapat_btn').setLabel('🔒 Kanalı Kapat').setStyle(ButtonStyle.Danger)
    );

    const araciMention = araciRol ? `<@&${araciRol.id}>` : '**Aracı**';
    await araciKanal.send({ content: `<@${user.id}> ${araciMention}`, embeds: [araciEmbed], components: [kapatRow] });
    return interaction.editReply({ content: `✅ Aracı kanalın oluşturuldu! <#${araciKanal.id}>` });
  }

  if (interaction.customId === 'pazar_kapat_btn') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: '❌ Sadece adminler kapatabilir!', ephemeral: true });
    const embed = new EmbedBuilder()
      .setTitle('🔒 Pazar Kanalı Kapatılıyor')
      .setDescription(`<@${interaction.user.id}> tarafından kapatıldı.\n5 saniye içinde silinecek...`)
      .setColor('#FF4500');
    await interaction.reply({ embeds: [embed] });
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
  }

  if (interaction.customId === 'araci_kapat_btn') {
    const embed = new EmbedBuilder()
      .setTitle('🔒 Aracı Kanalı Kapatılıyor')
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
    const kategori = guild.channels.cache.find(c => c.name === '🎫 Ticketlar' && c.type === ChannelType.GuildCategory);
    const ticketKanal = await guild.channels.create({
      name: `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      type: ChannelType.GuildText,
      parent: kategori ? kategori.id : null,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] },
        { id: guild.members.me.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
      ]
    });
    const ticketEmbed = new EmbedBuilder().setTitle(`🎫 Ticket — ${user.username}`)
      .setDescription(`Merhaba <@${user.id}>! 👋\n\nTicketin oluşturuldu. Sorununuzu detaylıca açıklayın.\nEkibimiz en kısa sürede size dönecek!`)
      .setColor('#5865F2')
      .addFields({ name: '👤 Açan', value: `<@${user.id}>`, inline: true }, { name: '📅 Tarih', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true })
      .setFooter({ text: 'Ticketi kapatmak için !kapat yazın' }).setTimestamp();
    const kapatRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_kapat_btn').setLabel('🔒 Ticketi Kapat').setStyle(ButtonStyle.Danger)
    );
    await ticketKanal.send({ content: `<@${user.id}>`, embeds: [ticketEmbed], components: [kapatRow] });
    return interaction.editReply({ content: `✅ Ticketin oluşturuldu! <#${ticketKanal.id}>` });
  }

  if (interaction.customId === 'ticket_bilgi') {
    const embed = new EmbedBuilder().setTitle('ℹ️ Ticket Hakkında')
      .setDescription('**Ticket Nedir?**\nTicket, sunucu yetkilileriyle özel iletişim kurmanı sağlar.\n\n**Ne Zaman Açmalıyım?**\n• Sorun yaşıyorsanız\n• Şikayet etmek istiyorsanız\n\n**Nasıl Kapatırım?**\n🔒 Kapat butonuna bas veya `!kapat` yaz')
      .setColor('#5865F2');
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (interaction.customId === 'ticket_kapat_btn') {
    const embed = new EmbedBuilder().setTitle('🔒 Ticket Kapatılıyor')
      .setDescription(`<@${interaction.user.id}> tarafından kapatıldı.\n5 saniye içinde silinecek...`).setColor('#FF4500');
    await interaction.reply({ embeds: [embed] });
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
  }
});



client.login(TOKEN);

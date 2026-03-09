const {
  Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits,
  SlashCommandBuilder, REST, Routes, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ChannelType
} = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildInvites,
  ],
});

// ════════════════════════════════════════════════════════════════
// VERİ DEPOLAMA (Bellekte - production'da MongoDB/SQLite kullanın)
// ════════════════════════════════════════════════════════════════
const db = {
  warnings: new Map(),       // guildId-userId => [{reason, mod, date}]
  xp: new Map(),             // guildId-userId => {xp, level}
  reps: new Map(),           // guildId-userId => {count, lastGiven}
  invites: new Map(),        // guildId-userId => count
  birthdays: new Map(),      // guildId-userId => "DD-MM"
  reminders: new Map(),      // userId => [{message, time, channelId}]
  guildSettings: new Map(),  // guildId => {logChannel, galeriChannel, öneriChannel, autoRole, prefix, yasakliKelimeler, yasakliKomutlar, xpPerMsg, slowmode}
  xpExempt: new Map(),       // guildId => {channels: [], roles: []}
  tickets: new Map(),        // channelId => {userId, guildId, createdAt}
  spawnerSettings: new Map(),// guildId => {alis, satis, minimum}
  inviteCache: new Map(),    // guildId => Map<code, {uses, inviterId, inviterTag}>
  inviteData: new Map(),     // guildId-userId => {total, left, fake, bonus, invitedUsers: [{id, tag, joinedAt, leftAt}]}
  economy: new Map(),        // guildId-userId => {balance, lastDaily, lastWork, lastRob}
  giveaways: new Map(),      // messageId => {prize, winners, endTime, channelId, guildId, entries, ended}
  starboard: new Map(),      // messageId => starboardMsgId
  polls: new Map(),          // messageId => {question, options, votes: Map<userId, optionIndex>, channelId}
  reactionRoles: new Map(),  // guildId => [{messageId, emojiId, roleId}]
  antispam: new Map(),       // guildId-userId => [{time}]
};

function getSettings(guildId) {
  if (!db.guildSettings.has(guildId)) db.guildSettings.set(guildId, {});
  return db.guildSettings.get(guildId);
}
// ── Invite Tracker Helpers ───────────────────────────────────────
function getInviteData(guildId, userId) {
  const key = `${guildId}-${userId}`;
  if (!db.inviteData.has(key)) db.inviteData.set(key, { total: 0, left: 0, fake: 0, bonus: 0, invitedUsers: [] });
  return db.inviteData.get(key);
}
function getRealInvites(data) { return Math.max(0, data.total - data.left - data.fake + data.bonus); }

function getEconomy(guildId, userId) {
  const key = `${guildId}-${userId}`;
  if (!db.economy.has(key)) db.economy.set(key, { balance: 0, lastDaily: 0, lastWork: 0, lastRob: 0 });
  return db.economy.get(key);
}

function getEconomyKey(guildId, userId) { return `${guildId}-${userId}`; }

function getGiveaway(messageId) { return db.giveaways.get(messageId); }

async function endGiveaway(giveaway, messageId, client) {
  if (giveaway.ended) return;
  giveaway.ended = true;
  const entries = [...giveaway.entries];
  const kazananSayisi = Math.min(giveaway.winners, entries.length);
  const kazananlar = [];
  const shuffled = entries.sort(() => Math.random() - 0.5);
  for (let i = 0; i < kazananSayisi; i++) kazananlar.push(shuffled[i]);

  try {
    const ch = client.channels.cache.get(giveaway.channelId);
    if (!ch) return;
    const msg = await ch.messages.fetch(messageId).catch(() => null);
    if (!msg) return;
    const kazananText = kazananlar.length ? kazananlar.map(id => `<@${id}>`).join(', ') : 'Kimse katılmadı 😢';
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`giveaway_join_${messageId}`).setLabel(`🎉 Katıl (${entries.length})`).setStyle(ButtonStyle.Success).setDisabled(true)
    );
    await msg.edit({
      embeds: [embed(0xf1c40f, '🎉 ÇEKİLİŞ SONA ERDİ', `**Ödül:** ${giveaway.prize}\n\n🏆 **Kazananlar:** ${kazananText}`, [
        { name: '👥 Toplam Katılımcı', value: `${entries.length}`, inline: true },
        { name: '🏆 Kazanan Sayısı', value: `${kazananSayisi}`, inline: true },
      ])],
      components: [row],
    });
    await ch.send({ content: kazananlar.length ? `🎊 Tebrikler ${kazananText}! **${giveaway.prize}** kazandınız!` : '😢 Çekilişe katılan olmadı.' });
  } catch (e) { console.error('Giveaway end error:', e); }
}

function getXP(guildId, userId) {
  const key = `${guildId}-${userId}`;
  if (!db.xp.has(key)) db.xp.set(key, { xp: 0, level: 1 });
  return db.xp.get(key);
}
function addXP(guildId, userId, amount) {
  const data = getXP(guildId, userId);
  data.xp += amount;
  const needed = data.level * 100;
  let leveled = false;
  if (data.xp >= needed) { data.xp -= needed; data.level++; leveled = true; }
  return { ...data, leveled };
}
function getWarnings(guildId, userId) {
  return db.warnings.get(`${guildId}-${userId}`) || [];
}
function addWarning(guildId, userId, reason, mod) {
  const key = `${guildId}-${userId}`;
  if (!db.warnings.has(key)) db.warnings.set(key, []);
  db.warnings.get(key).push({ reason, mod, date: new Date() });
  return db.warnings.get(key).length;
}

// ════════════════════════════════════════════════════════════════
// EMBED YARDIMCILARI
// ════════════════════════════════════════════════════════════════
const Colors = { success: 0x2ecc71, error: 0xe74c3c, info: 0x3498db, warn: 0xf39c12, purple: 0x9b59b6, teal: 0x1abc9c, gold: 0xf1c40f };

function embed(color, title, desc, fields = []) {
  const e = new EmbedBuilder().setColor(color).setTimestamp();
  if (title) e.setTitle(title);
  if (desc) e.setDescription(desc);
  if (fields.length) e.addFields(fields);
  return e;
}
const ok = (t, d, f) => embed(Colors.success, `✅ ${t}`, d, f);
const err = (d) => embed(Colors.error, '❌ Hata', d);
const info = (t, d, f) => embed(Colors.info, `ℹ️ ${t}`, d, f);
const warn = (t, d, f) => embed(Colors.warn, `⚠️ ${t}`, d, f);

// ════════════════════════════════════════════════════════════════
// SLASH COMMAND TANIMLARI
// ════════════════════════════════════════════════════════════════
const commands = [
  // ── MODERASYon ──
  new SlashCommandBuilder().setName('ban').setDescription('Kullanıcıyı banlar').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addStringOption(o => o.setName('sebep').setDescription('Sebep')),

  new SlashCommandBuilder().setName('kick').setDescription('Kullanıcıyı atar').setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addStringOption(o => o.setName('sebep').setDescription('Sebep')),

  new SlashCommandBuilder().setName('mute').setDescription('Kullanıcıyı susturur').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addIntegerOption(o => o.setName('sure').setDescription('Süre (dakika)').setRequired(true).setMinValue(1).setMaxValue(10080))
    .addStringOption(o => o.setName('sebep').setDescription('Sebep')),

  new SlashCommandBuilder().setName('unmute').setDescription('Susturmayı kaldırır').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)),

  new SlashCommandBuilder().setName('warn').setDescription('Kullanıcıya uyarı verir').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addStringOption(o => o.setName('sebep').setDescription('Sebep').setRequired(true)),

  new SlashCommandBuilder().setName('uyarilar').setDescription('Kullanıcının uyarılarını listeler')
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)),

  new SlashCommandBuilder().setName('temizle').setDescription('Mesajları siler').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('sayi').setDescription('Silinecek mesaj sayısı (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder().setName('isim-duzeltme').setDescription('Uygunsuz üye ismini değiştirir').setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addStringOption(o => o.setName('yeniad').setDescription('Yeni isim').setRequired(true)),

  new SlashCommandBuilder().setName('isimdegistir').setDescription('Üyenin ismini değiştirir').setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addStringOption(o => o.setName('yeniad').setDescription('Yeni isim').setRequired(true)),

  new SlashCommandBuilder().setName('yasakli-kelime').setDescription('Yasaklı kelime ekle/çıkar/listele').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('islem').setDescription('ekle / sil / liste').setRequired(true).addChoices(
      { name: 'Ekle', value: 'ekle' }, { name: 'Sil', value: 'sil' }, { name: 'Liste', value: 'liste' }
    ))
    .addStringOption(o => o.setName('kelime').setDescription('Kelime')),

  new SlashCommandBuilder().setName('yasakli-komut').setDescription('Yasaklı komut ekle/çıkar/listele').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('islem').setDescription('ekle / sil / liste').setRequired(true).addChoices(
      { name: 'Ekle', value: 'ekle' }, { name: 'Sil', value: 'sil' }, { name: 'Liste', value: 'liste' }
    ))
    .addStringOption(o => o.setName('komut').setDescription('Komut adı')),

  new SlashCommandBuilder().setName('yavasmod').setDescription('Kanalın yavaş modunu ayarlar').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(o => o.setName('saniye').setDescription('Saniye (0 = kapat)').setRequired(true).setMinValue(0).setMaxValue(21600)),

  // ── AYARLAR ──
  new SlashCommandBuilder().setName('log').setDescription('Log kanalını ayarlar').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('kanal').setDescription('Log kanalı').setRequired(true)),

  new SlashCommandBuilder().setName('loglar').setDescription('Mevcut log ayarlarını gösterir').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder().setName('galeri').setDescription('Galeri kanalını ayarlar').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('kanal').setDescription('Galeri kanalı').setRequired(true)),

  new SlashCommandBuilder().setName('oneri').setDescription('Öneri kanalını ayarlar').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('kanal').setDescription('Öneri kanalı').setRequired(true)),

  new SlashCommandBuilder().setName('oto-rol').setDescription('Yeni üyelere verilecek rolü ayarlar').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(o => o.setName('rol').setDescription('Otomatik rol').setRequired(true)),

  new SlashCommandBuilder().setName('prefix').setDescription('Bota özel prefix ekle').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('prefix').setDescription('Yeni prefix').setRequired(true)),

  new SlashCommandBuilder().setName('tecrubemiktar').setDescription('Mesaj başına tecrübe miktarını ayarlar').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('miktar').setDescription('Tecrübe miktarı').setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder().setName('rankmuaf').setDescription('Tecrübe vermeyen kanal/rol ekle-çıkar').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('tip').setDescription('kanal veya rol').setRequired(true).addChoices(
      { name: 'Kanal', value: 'kanal' }, { name: 'Rol', value: 'rol' }
    ))
    .addStringOption(o => o.setName('islem').setDescription('ekle veya sil').setRequired(true).addChoices(
      { name: 'Ekle', value: 'ekle' }, { name: 'Sil', value: 'sil' }
    ))
    .addChannelOption(o => o.setName('kanal').setDescription('Kanal'))
    .addRoleOption(o => o.setName('rol').setDescription('Rol')),

  new SlashCommandBuilder().setName('seviyeatla-mesaj').setDescription('Seviye atlama mesajını belirler').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('mesaj').setDescription('Mesaj ({user} ve {level} kullanabilirsin)').setRequired(true)),

  new SlashCommandBuilder().setName('rank-ayar').setDescription('Rank sistemi ayarları').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption(o => o.setName('aktif').setDescription('Rank sistemini aç/kapa').setRequired(true)),

  new SlashCommandBuilder().setName('seviye-rol').setDescription('Seviyeye göre rol ata').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('seviye').setDescription('Seviye').setRequired(true))
    .addRoleOption(o => o.setName('rol').setDescription('Rol').setRequired(true)),

  new SlashCommandBuilder().setName('gorevli').setDescription('Görevli (yetkili) sistemini ayarlar').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption(o => o.setName('rol').setDescription('Görevli rolü').setRequired(true)),

  // ── KULLANICI / BİLGİ ──
  new SlashCommandBuilder().setName('userinfo').setDescription('Kullanıcı hakkında bilgi gösterir')
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı')),

  new SlashCommandBuilder().setName('avatar').setDescription('Kullanıcının avatarını gösterir')
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı')),

  new SlashCommandBuilder().setName('sunucu').setDescription('Sunucu hakkında bilgi verir'),

  new SlashCommandBuilder().setName('roller').setDescription('Sunucudaki rolleri listeler'),

  new SlashCommandBuilder().setName('id').setDescription('Nesne ID arama')
    .addStringOption(o => o.setName('nesne').setDescription('Kullanıcı/Rol/Kanal adı').setRequired(true)),

  new SlashCommandBuilder().setName('shard').setDescription('Botun shard bilgilerini gösterir'),

  new SlashCommandBuilder().setName('istatistik').setDescription('Bot istatistiklerini gösterir'),

  // ── RANK / XP ──
  new SlashCommandBuilder().setName('rank').setDescription('Rank kartını gösterir')
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı')),

  new SlashCommandBuilder().setName('rankboost').setDescription('Extra tecrübe kazandır').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addIntegerOption(o => o.setName('miktar').setDescription('Eklenecek XP').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName('top').setDescription('En yüksek XP\'e sahip üyeler'),

  // ── EĞLENCE / ARAÇLAR ──
  new SlashCommandBuilder().setName('ship').setDescription('İki kişi arasındaki uyumu ölçer')
    .addUserOption(o => o.setName('kisi1').setDescription('1. Kişi').setRequired(true))
    .addUserOption(o => o.setName('kisi2').setDescription('2. Kişi')),

  new SlashCommandBuilder().setName('qr').setDescription('Metni QR koduna dönüştürür')
    .addStringOption(o => o.setName('metin').setDescription('QR\'a çevrilecek metin').setRequired(true)),

  new SlashCommandBuilder().setName('renk').setDescription('Renk kodu hakkında bilgi verir')
    .addStringOption(o => o.setName('hex').setDescription('HEX renk kodu (örn: #ff5733)').setRequired(true)),

  new SlashCommandBuilder().setName('tersçevir').setDescription('Girilen yazıyı tersten yazar')
    .addStringOption(o => o.setName('metin').setDescription('Metin').setRequired(true)),

  new SlashCommandBuilder().setName('pankart').setDescription('Pankarta yazı yazdırır')
    .addStringOption(o => o.setName('metin').setDescription('Pankart metni').setRequired(true)),

  new SlashCommandBuilder().setName('surecevir').setDescription('Saniyeyi süreye çevirir')
    .addIntegerOption(o => o.setName('saniye').setDescription('Saniye').setRequired(true)),

  new SlashCommandBuilder().setName('doviz').setDescription('Güncel döviz kuru')
    .addStringOption(o => o.setName('para').setDescription('Para birimi (USD, EUR, GBP...)').setRequired(true)),

  new SlashCommandBuilder().setName('clyde').setDescription('Clyde bota fake mesaj yazdırır').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName('mesaj').setDescription('Mesaj').setRequired(true)),

  new SlashCommandBuilder().setName('konustur').setDescription('İstenen üyeye mesaj yazdırır').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addStringOption(o => o.setName('mesaj').setDescription('Mesaj').setRequired(true)),

  new SlashCommandBuilder().setName('embed').setDescription('Embed oluşturucu').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName('baslik').setDescription('Başlık').setRequired(true))
    .addStringOption(o => o.setName('icerik').setDescription('İçerik').setRequired(true))
    .addStringOption(o => o.setName('renk').setDescription('Renk (hex, örn: #ff0000)'))
    .addChannelOption(o => o.setName('kanal').setDescription('Gönderilecek kanal')),

  // ── SOSYAL ──
  new SlashCommandBuilder().setName('rep').setDescription('Bir üyeye günlük rep verir')
    .addUserOption(o => o.setName('kullanici').setDescription('Rep verilecek kullanıcı').setRequired(true)),

  new SlashCommandBuilder().setName('profil').setDescription('Profil kartını gösterir')
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı')),

  new SlashCommandBuilder().setName('dogumgunu').setDescription('Doğum günü kaydet/göster')
    .addStringOption(o => o.setName('islem').setDescription('ayarla veya göster').setRequired(true).addChoices(
      { name: 'Ayarla', value: 'ayarla' }, { name: 'Göster', value: 'goster' }
    ))
    .addStringOption(o => o.setName('tarih').setDescription('Doğum günü (GG-AA formatında, örn: 15-03)')),

  new SlashCommandBuilder().setName('hatirlatici').setDescription('Hatırlatıcı kurar')
    .addIntegerOption(o => o.setName('dakika').setDescription('Kaç dakika sonra').setRequired(true).setMinValue(1))
    .addStringOption(o => o.setName('mesaj').setDescription('Hatırlatıcı mesajı').setRequired(true)),

  new SlashCommandBuilder().setName('katilim').setDescription('Giriş tarihine göre üyeleri listeler'),

  new SlashCommandBuilder().setName('davet').setDescription('Bot hakkında davet bilgisi verir'),

  new SlashCommandBuilder().setName('davetler').setDescription('Kullanıcının detaylı davet istatistiklerini gösterir')
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı')),

  new SlashCommandBuilder().setName('davet-liste').setDescription('Davet ettiğin kişilerin listesi')
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı (boş bırakırsan kendin)'))
    .addStringOption(o => o.setName('filtre').setDescription('Filtre').addChoices(
      { name: 'Tümü', value: 'hepsi' },
      { name: 'Hâlâ sunucuda', value: 'aktif' },
      { name: 'Ayrılanlar', value: 'ayrilanlar' },
    )),

  new SlashCommandBuilder().setName('davet-liderboard').setDescription('En çok davet yapanlar sıralaması'),

  new SlashCommandBuilder().setName('davet-sifirla').setDescription('Kullanıcının davet sayısını sıfırla').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)),

  new SlashCommandBuilder().setName('davet-bonus').setDescription('Bonus davet ekle').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addIntegerOption(o => o.setName('miktar').setDescription('Davet sayısı').setRequired(true)),

  new SlashCommandBuilder().setName('davetlog').setDescription('Davet log kanalını ayarlar').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('kanal').setDescription('Kanal').setRequired(true)),

  new SlashCommandBuilder().setName('davet-rol').setDescription('Davet ödül sistemi').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('adet').setDescription('Kaç davet').setRequired(true))
    .addRoleOption(o => o.setName('rol').setDescription('Kazanılacak rol').setRequired(true)),

  // ── GENEL ──
  new SlashCommandBuilder().setName('06yardim').setDescription('Tüm komutları listeler'),

  new SlashCommandBuilder().setName('ye').setDescription('Botu deneyip öğrenebilirsiniz'),

  new SlashCommandBuilder().setName('hedef').setDescription('Üye hedef sistemini gösterir'),

  new SlashCommandBuilder().setName('bildirim').setDescription('YouTube/Twitch/Instagram bildirim sistemi').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('platform').setDescription('Platform').setRequired(true).addChoices(
      { name: 'YouTube', value: 'youtube' }, { name: 'Twitch', value: 'twitch' }, { name: 'Instagram', value: 'instagram' }
    ))
    .addStringOption(o => o.setName('kanal_adi').setDescription('Kanal/kullanıcı adı').setRequired(true))
    .addChannelOption(o => o.setName('discord_kanal').setDescription('Bildirim kanalı').setRequired(true)),

  new SlashCommandBuilder().setName('oyun').setDescription('Sayı sayma, kelime türetme, bom oyunları')
    .addStringOption(o => o.setName('oyun').setDescription('Oyun seç').setRequired(true).addChoices(
      { name: 'Sayı Sayma', value: 'sayi' }, { name: 'Kelime Türetme', value: 'kelime' }, { name: 'Bomba', value: 'bom' }
    )),

  new SlashCommandBuilder().setName('ozelkomut-ekle').setDescription('Özel komut ekle').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('komut').setDescription('Komut adı').setRequired(true))
    .addStringOption(o => o.setName('yanit').setDescription('Bot yanıtı').setRequired(true)),

  new SlashCommandBuilder().setName('tag').setDescription('Özel tag oluştur')
    .addStringOption(o => o.setName('ad').setDescription('Tag adı').setRequired(true))
    .addStringOption(o => o.setName('icerik').setDescription('İçerik').setRequired(true)),

  new SlashCommandBuilder().setName('ozeloda').setDescription('Özel oda sistemi').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('kanal').setDescription('Özel oda join kanalı').setRequired(true)),

  new SlashCommandBuilder().setName('emoji').setDescription('Emoji ekle/sil/listele').setDefaultMemberPermissions(PermissionFlagsBits.ManageEmojisAndStickers)
    .addStringOption(o => o.setName('islem').setDescription('ekle / sil / liste').setRequired(true).addChoices(
      { name: 'Ekle', value: 'ekle' }, { name: 'Sil', value: 'sil' }, { name: 'Liste', value: 'liste' }
    ))
    .addStringOption(o => o.setName('ad').setDescription('Emoji adı')),

  // ── TİCKET SİSTEMİ ──
  // ── EKONOMİ ──
  new SlashCommandBuilder().setName('para').setDescription('Para bakiyeni gösterir')
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı')),

  new SlashCommandBuilder().setName('gunluk').setDescription('Günlük para ödülünü al'),

  new SlashCommandBuilder().setName('calis').setDescription('Çalışarak para kazan'),

  new SlashCommandBuilder().setName('cal').setDescription('Birinin parasını çalmaya çalış')
    .addUserOption(o => o.setName('kullanici').setDescription('Hedef kullanıcı').setRequired(true)),

  new SlashCommandBuilder().setName('transfer').setDescription('Birine para gönder')
    .addUserOption(o => o.setName('kullanici').setDescription('Alıcı').setRequired(true))
    .addIntegerOption(o => o.setName('miktar').setDescription('Miktar').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName('kumar').setDescription('Para yatır, şansını dene')
    .addIntegerOption(o => o.setName('miktar').setDescription('Miktar (veya "hepsi")').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName('zenginler').setDescription('Sunucunun en zengin üyeleri'),

  new SlashCommandBuilder().setName('para-ver').setDescription('Kullanıcıya para ver').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addIntegerOption(o => o.setName('miktar').setDescription('Miktar').setRequired(true)),

  new SlashCommandBuilder().setName('para-al').setDescription('Kullanıcıdan para al').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addIntegerOption(o => o.setName('miktar').setDescription('Miktar').setRequired(true)),

  // ── ÇEKİLİŞ ──
  new SlashCommandBuilder().setName('cekilisbaslat').setDescription('Çekiliş başlat').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('odul').setDescription('Ödül').setRequired(true))
    .addIntegerOption(o => o.setName('sure').setDescription('Süre (dakika)').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('kazanan').setDescription('Kazanan sayısı').setRequired(false).setMinValue(1).setMaxValue(10))
    .addChannelOption(o => o.setName('kanal').setDescription('Çekiliş kanalı')),

  new SlashCommandBuilder().setName('cekilisbitir').setDescription('Çekilişi erken bitir').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('mesaj_id').setDescription('Çekiliş mesajı ID').setRequired(true)),

  new SlashCommandBuilder().setName('cekilistekrar').setDescription('Çekilişi tekrar çek').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('mesaj_id').setDescription('Çekiliş mesajı ID').setRequired(true)),

  // ── DOĞRULAMA ──
  new SlashCommandBuilder().setName('dogrulama-kur').setDescription('Doğrulama panelini kur').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('kanal').setDescription('Doğrulama kanalı').setRequired(true))
    .addRoleOption(o => o.setName('rol').setDescription('Verilecek rol').setRequired(true)),

  // ── STARBOARD ──
  new SlashCommandBuilder().setName('starboard-kur').setDescription('Starboard kanalını ayarlar').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('kanal').setDescription('Starboard kanalı').setRequired(true))
    .addIntegerOption(o => o.setName('esik').setDescription('Kaç ⭐ gerekli (varsayılan: 3)').setMinValue(1)),

  // ── ANKET ──
  new SlashCommandBuilder().setName('anket').setDescription('Butonlu anket oluştur')
    .addStringOption(o => o.setName('soru').setDescription('Anket sorusu').setRequired(true))
    .addStringOption(o => o.setName('secenek1').setDescription('1. Seçenek').setRequired(true))
    .addStringOption(o => o.setName('secenek2').setDescription('2. Seçenek').setRequired(true))
    .addStringOption(o => o.setName('secenek3').setDescription('3. Seçenek'))
    .addStringOption(o => o.setName('secenek4').setDescription('4. Seçenek')),

  // ── ROL SEÇİCİ ──
  new SlashCommandBuilder().setName('rol-secici').setDescription('Rol seçici panel kur').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('baslik').setDescription('Panel başlığı').setRequired(true))
    .addStringOption(o => o.setName('roller').setDescription('Rol IDlerini virgülle ayır').setRequired(true)),

  // ── EĞLENCE ──
  new SlashCommandBuilder().setName('8top').setDescription('8-Ball sihirli topuna sor')
    .addStringOption(o => o.setName('soru').setDescription('Sorunuzu yazın').setRequired(true)),

  new SlashCommandBuilder().setName('yada').setDescription('Would you rather - hangisini tercih edersin?'),

  new SlashCommandBuilder().setName('trivia').setDescription('Trivia sorusu sor'),

  new SlashCommandBuilder().setName('sarap').setDescription('Birini sar 🌯')
    .addUserOption(o => o.setName('kullanici').setDescription('Kim sarılsın?').setRequired(true)),

  new SlashCommandBuilder().setName('tokat').setDescription('Birine tokat at 👋')
    .addUserOption(o => o.setName('kullanici').setDescription('Kime?').setRequired(true)),

  new SlashCommandBuilder().setName('dans').setDescription('Dans et 💃'),

  new SlashCommandBuilder().setName('yuksek-alcak').setDescription('Yüksek mi alçak mı? Sayı tahmin et'),

  new SlashCommandBuilder().setName('zar').setDescription('Zar at 🎲')
    .addIntegerOption(o => o.setName('yuz').setDescription('Kaç yüzlü zar (varsayılan 6)').setMinValue(2).setMaxValue(100)),

  new SlashCommandBuilder().setName('yaztura').setDescription('Yazı tura at 🪙'),

  new SlashCommandBuilder().setName('rastgeleüye').setDescription('Sunucudan rastgele üye seç'),

  new SlashCommandBuilder().setName('kelimeuzunluk').setDescription('En uzun kelimeyi kim yazar? (30sn)'),

  // ── ANTİ-SPAM ──
  new SlashCommandBuilder().setName('antispam').setDescription('Anti-spam sistemini aç/kapa').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption(o => o.setName('aktif').setDescription('Aç/kapa').setRequired(true))
    .addIntegerOption(o => o.setName('limit').setDescription('Kaç mesaj spam sayılır (varsayılan: 5)').setMinValue(3).setMaxValue(20)),

  new SlashCommandBuilder().setName('ticket-kur').setDescription('Ticket sistemini belirtilen kanala kurar').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('kanal').setDescription('Ticket mesajının gönderileceği kanal').setRequired(true))
    .addChannelOption(o => o.setName('ticket-kategori').setDescription('Ticketların açılacağı kategori').setRequired(true))
    .addRoleOption(o => o.setName('destek-rol').setDescription('Ticketları görecek destek ekibi rolü').setRequired(true)),

  new SlashCommandBuilder().setName('ticket-kapat').setDescription('Mevcut ticket kanalını kapatır'),

  // ── SPAWNER MARKET ──
  new SlashCommandBuilder().setName('spawner-market-kur').setDescription('Spawner Market panelini belirtilen kanala kurar').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o => o.setName('kanal').setDescription('Market mesajının gönderileceği kanal').setRequired(true)),

  new SlashCommandBuilder().setName('spawner-fiyat').setDescription('Spawner alış/satış fiyatlarını günceller').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(o => o.setName('alis').setDescription('Alış fiyatı (biz satın alıyoruz)').setRequired(true))
    .addIntegerOption(o => o.setName('satis').setDescription('Satış fiyatı (biz satıyoruz)').setRequired(true))
    .addIntegerOption(o => o.setName('minimum').setDescription('Minimum stack adedi').setRequired(false)),


  // ── EKONOMİ SİSTEMİ ──
  new SlashCommandBuilder().setName('bakiye').setDescription('Bakiyeni veya başka birinin bakiyesini gösterir')
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı')),

  new SlashCommandBuilder().setName('gunluk').setDescription('Günlük para ödülünü al (24 saatte bir)'),

  new SlashCommandBuilder().setName('calis').setDescription('Para kazanmak için çalış (1 saatte bir)'),

  new SlashCommandBuilder().setName('transfer').setDescription('Başka bir kullanıcıya para gönder')
    .addUserOption(o => o.setName('kullanici').setDescription('Para gönderilecek kullanıcı').setRequired(true))
    .addIntegerOption(o => o.setName('miktar').setDescription('Gönderilecek miktar').setRequired(true).setMinValue(1)),

  new SlashCommandBuilder().setName('soygun').setDescription('Birinin parasını çalmaya çalış (riskli!)')
    .addUserOption(o => o.setName('kullanici').setDescription('Hedef kullanıcı').setRequired(true)),

  new SlashCommandBuilder().setName('yazı-tura').setDescription('Yazı tura ile para kazan/kaybet')
    .addStringOption(o => o.setName('secim').setDescription('Yazı veya Tura').setRequired(true).addChoices(
      { name: '🪙 Yazı', value: 'yazi' }, { name: '🔵 Tura', value: 'tura' }
    ))
    .addIntegerOption(o => o.setName('miktar').setDescription('Bahis miktarı').setRequired(true).setMinValue(10)),

  new SlashCommandBuilder().setName('zar').setDescription('Zar at, yüksek çıkarsa kazanırsın')
    .addIntegerOption(o => o.setName('miktar').setDescription('Bahis miktarı').setRequired(true).setMinValue(10)),

  new SlashCommandBuilder().setName('rulet').setDescription('Rulet oyna - kırmızı/siyah/yeşil')
    .addStringOption(o => o.setName('renk').setDescription('Bahis rengi').setRequired(true).addChoices(
      { name: '🔴 Kırmızı (x2)', value: 'kirmizi' },
      { name: '⚫ Siyah (x2)', value: 'siyah' },
      { name: '🟢 Yeşil (x14)', value: 'yesil' }
    ))
    .addIntegerOption(o => o.setName('miktar').setDescription('Bahis miktarı').setRequired(true).setMinValue(10)),

  new SlashCommandBuilder().setName('zenginler').setDescription('En zengin üyelerin listesi'),

  new SlashCommandBuilder().setName('para-ver').setDescription('Bir kullanıcıya para ver (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addIntegerOption(o => o.setName('miktar').setDescription('Miktar').setRequired(true)),

  new SlashCommandBuilder().setName('para-al').setDescription('Bir kullanıcıdan para al (Admin)').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addIntegerOption(o => o.setName('miktar').setDescription('Miktar').setRequired(true)),

  // ── SOSYAL / GIF KOMUTLARI ──
  new SlashCommandBuilder().setName('hug').setDescription('Birini kucakla 🤗')
    .addUserOption(o => o.setName('kullanici').setDescription('Kucaklanacak kişi').setRequired(true)),

  new SlashCommandBuilder().setName('slap').setDescription('Birini tokatlaa 👋')
    .addUserOption(o => o.setName('kullanici').setDescription('Tokatlanan kişi').setRequired(true)),

  new SlashCommandBuilder().setName('pat').setDescription('Birini başından okşa 😊')
    .addUserOption(o => o.setName('kullanici').setDescription('Okşanan kişi').setRequired(true)),

  new SlashCommandBuilder().setName('kiss').setDescription('Birini öp 💋')
    .addUserOption(o => o.setName('kullanici').setDescription('Öpülen kişi').setRequired(true)),

  new SlashCommandBuilder().setName('cry').setDescription('Ağla 😭'),

  new SlashCommandBuilder().setName('dance').setDescription('Dans et 💃'),

  // ── ANKet & ÇEKİLİŞ ──
  new SlashCommandBuilder().setName('anket').setDescription('Oylama anketi oluştur').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName('soru').setDescription('Anket sorusu').setRequired(true))
    .addStringOption(o => o.setName('secenek1').setDescription('1. Seçenek').setRequired(true))
    .addStringOption(o => o.setName('secenek2').setDescription('2. Seçenek').setRequired(true))
    .addStringOption(o => o.setName('secenek3').setDescription('3. Seçenek (isteğe bağlı)'))
    .addStringOption(o => o.setName('secenek4').setDescription('4. Seçenek (isteğe bağlı)')),

  new SlashCommandBuilder().setName('cekilisbaslat').setDescription('Çekiliş başlat').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('odul').setDescription('Ödül').setRequired(true))
    .addIntegerOption(o => o.setName('sure').setDescription('Süre (dakika)').setRequired(true).setMinValue(1))
    .addIntegerOption(o => o.setName('kazanan').setDescription('Kazanan sayısı').setRequired(false).setMinValue(1).setMaxValue(10)),

  new SlashCommandBuilder().setName('cekilis-bitis').setDescription('Çekilişi erken bitir ve kazananı seç').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('mesaj-id').setDescription('Çekiliş mesaj IDsi').setRequired(true)),

  // ── REACTİON ROLES ──
  new SlashCommandBuilder().setName('rol-panel').setDescription('Üyelerin tıklayarak rol alabileceği panel oluşturur').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('baslik').setDescription('Panel başlığı').setRequired(true))
    .addStringOption(o => o.setName('aciklama').setDescription('Panel açıklaması').setRequired(true)),

  new SlashCommandBuilder().setName('rol-buton-ekle').setDescription('Rol paneline buton ekle').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o.setName('mesaj-id').setDescription('Panel mesaj IDsi').setRequired(true))
    .addRoleOption(o => o.setName('rol').setDescription('Verilecek rol').setRequired(true))
    .addStringOption(o => o.setName('etiket').setDescription('Buton yazısı').setRequired(true))
    .addStringOption(o => o.setName('emoji').setDescription('Buton emojisi (isteğe bağlı)')),

  // ── GELİŞMİŞ MODERASYON ──
  new SlashCommandBuilder().setName('antispam').setDescription('Anti-spam sistemi ayarları').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption(o => o.setName('aktif').setDescription('Aç/Kapa').setRequired(true))
    .addIntegerOption(o => o.setName('esik').setDescription('Kaç saniyede kaç mesaj spam sayılır').setMinValue(3).setMaxValue(20)),

  new SlashCommandBuilder().setName('antiraid').setDescription('Anti-raid sistemi (hızlı üye girişi)').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption(o => o.setName('aktif').setDescription('Aç/Kapa').setRequired(true)),

  new SlashCommandBuilder().setName('lock').setDescription('Kanalı kilitle (sadece yetkililer yazabilir)').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o => o.setName('kanal').setDescription('Kanal (boş bırakırsan mevcut kanal)')),

  new SlashCommandBuilder().setName('unlock').setDescription('Kanal kilidini aç').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption(o => o.setName('kanal').setDescription('Kanal (boş bırakırsan mevcut kanal)')),

  new SlashCommandBuilder().setName('duyuru').setDescription('Bir kanala duyuru gönder').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addChannelOption(o => o.setName('kanal').setDescription('Duyuru kanalı').setRequired(true))
    .addStringOption(o => o.setName('mesaj').setDescription('Duyuru metni').setRequired(true))
    .addRoleOption(o => o.setName('etiketle').setDescription('Etiketlenecek rol')),

  new SlashCommandBuilder().setName('unban').setDescription('Kullanıcının banını kaldırır').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('kullanici-id').setDescription('Kullanıcı IDsi').setRequired(true)),

  new SlashCommandBuilder().setName('banlist').setDescription('Sunucudaki banlı kullanıcıları listeler').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder().setName('uyari-sil').setDescription('Kullanıcının uyarılarını siler').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addIntegerOption(o => o.setName('index').setDescription('Uyarı numarası (boş=hepsi)').setMinValue(1)),

].map(c => c.toJSON());

// ════════════════════════════════════════════════════════════════
// BOT HAZIR
// ════════════════════════════════════════════════════════════════
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} olarak giriş yapıldı!`);
  client.user.setActivity('Sunucuyu koruyorum 🛡️', { type: 3 });

  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    console.log('⏳ Slash komutları kaydediliyor...');
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash komutları başarıyla kaydedildi!');
  } catch (err) {
    console.error('❌ Komut kaydı hatası:', err);
  }

  // Invite cache'i başlat
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      const cache = new Map();
      invites.forEach(inv => cache.set(inv.code, { uses: inv.uses, inviterId: inv.inviter?.id, inviterTag: inv.inviter?.tag }));
      db.inviteCache.set(guild.id, cache);
    } catch(e) {}
  }

  // Çekiliş kontrolü - her 15 saniyede
  setInterval(async () => {
    const now = Date.now();
    for (const [msgId, giveaway] of db.giveaways) {
      if (!giveaway.ended && giveaway.endTime <= now) {
        await endGiveaway(giveaway, msgId, client);
      }
    }
  }, 15000);
});

// ════════════════════════════════════════════════════════════════
// ANTİ-SPAM
// ════════════════════════════════════════════════════════════════
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  const settings = getSettings(message.guild.id);
  if (!settings.antispam?.aktif) return;

  const limit = settings.antispam.limit || 5;
  const key = `${message.guild.id}-${message.author.id}`;
  const now = Date.now();
  if (!db.antispam.has(key)) db.antispam.set(key, []);
  const times = db.antispam.get(key);
  times.push(now);
  // Son 5 saniyedeki mesajları filtrele
  const recent = times.filter(t => now - t < 5000);
  db.antispam.set(key, recent);

  if (recent.length >= limit) {
    db.antispam.delete(key);
    const member = message.guild.members.cache.get(message.author.id);
    if (member) {
      await member.timeout(5 * 60 * 1000, 'Anti-spam: Çok fazla mesaj').catch(() => {});
      await message.channel.send({ embeds: [warn('🚫 Anti-Spam', `${message.author} çok hızlı mesaj gönderdi ve **5 dakika** susturuldu.`)] }).then(m => setTimeout(() => m.delete().catch(() => {}), 8000));
    }
  }
});

// ════════════════════════════════════════════════════════════════
// XP SİSTEMİ - Mesaj Dinleyici
// ════════════════════════════════════════════════════════════════
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const settings = getSettings(message.guild.id);
  if (!settings.rankAktif) return;

  const exempt = db.xpExempt.get(message.guild.id) || { channels: [], roles: [] };
  if (exempt.channels.includes(message.channel.id)) return;
  if (message.member?.roles.cache.some(r => exempt.roles.includes(r.id))) return;

  // Yasaklı kelime kontrolü
  if (settings.yasakliKelimeler?.length) {
    const lower = message.content.toLowerCase();
    if (settings.yasakliKelimeler.some(k => lower.includes(k))) {
      await message.delete().catch(() => {});
      const uyari = await message.channel.send({ embeds: [warn('Yasaklı Kelime', `${message.author}, bu kelimeyi kullanamazsın!`)] });
      setTimeout(() => uyari.delete().catch(() => {}), 5000);
      return;
    }
  }

  const xpGain = settings.xpPerMsg || 10;
  const result = addXP(message.guild.id, message.author.id, xpGain);

  if (result.leveled) {
    const lvlMsg = (settings.seviyeAtlamaMesaji || '{user} seviye atladı! Yeni seviye: **{level}**')
      .replace('{user}', `<@${message.author.id}>`)
      .replace('{level}', result.level);
    await message.channel.send({ embeds: [ok('🎉 Seviye Atlandı!', lvlMsg)] });
  }
});

// ════════════════════════════════════════════════════════════════
// YENİ ÜYE - Oto Rol
// ════════════════════════════════════════════════════════════════
client.on('inviteCreate', async invite => {
  const cache = db.inviteCache.get(invite.guild.id) || new Map();
  cache.set(invite.code, { uses: invite.uses, inviterId: invite.inviter?.id, inviterTag: invite.inviter?.tag });
  db.inviteCache.set(invite.guild.id, cache);
});

client.on('inviteDelete', async invite => {
  const cache = db.inviteCache.get(invite.guild.id);
  if (cache) cache.delete(invite.code);
});

client.on('guildMemberAdd', async member => {
  const { guild } = member;
  const settings = getSettings(guild.id);

  // ── Oto Rol ──────────────────────────────────────────────
  if (settings.autoRole) {
    const role = guild.roles.cache.get(settings.autoRole);
    if (role) await member.roles.add(role).catch(() => {});
  }

  // ── Invite Tracking ───────────────────────────────────────
  let inviterId = null, inviterTag = 'Bilinmiyor', usedCode = null;
  try {
    const oldCache = db.inviteCache.get(guild.id) || new Map();
    const newInvites = await guild.invites.fetch();

    for (const [code, inv] of newInvites) {
      const old = oldCache.get(code);
      if (old && inv.uses > old.uses) {
        inviterId = inv.inviter?.id;
        inviterTag = inv.inviter?.tag || 'Bilinmiyor';
        usedCode = code;
        break;
      }
      if (!old && inv.uses > 0) {
        inviterId = inv.inviter?.id;
        inviterTag = inv.inviter?.tag || 'Bilinmiyor';
        usedCode = code;
        break;
      }
    }

    // Cache güncelle
    const newCache = new Map();
    newInvites.forEach(inv => newCache.set(inv.code, { uses: inv.uses, inviterId: inv.inviter?.id, inviterTag: inv.inviter?.tag }));
    db.inviteCache.set(guild.id, newCache);

    // Davet datasını güncelle
    if (inviterId) {
      const invData = getInviteData(guild.id, inviterId);
      invData.total++;
      const isNewAccount = (Date.now() - member.user.createdTimestamp) < 7 * 24 * 60 * 60 * 1000;
      if (isNewAccount) invData.fake++;
      invData.invitedUsers.push({ id: member.user.id, tag: member.user.tag, joinedAt: Date.now(), leftAt: null });
    }
  } catch(e) {}

  // ── Davet Log ─────────────────────────────────────────────
  const logChanId = settings.davetLogChannel || settings.logChannel;
  if (logChanId) {
    const logCh = guild.channels.cache.get(logChanId);
    if (logCh) {
      const invData = inviterId ? getInviteData(guild.id, inviterId) : null;
      const realCount = invData ? getRealInvites(invData) : 0;
      const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / (1000 * 60 * 60 * 24));
      const isNewAcc = accountAge < 7;

      const joinEmbed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('📥 Sunucuya Katıldı')
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '👤 Üye', value: `${member.user} (${member.user.tag})`, inline: false },
          { name: '🆔 ID', value: member.user.id, inline: true },
          { name: '📅 Hesap Yaşı', value: `${accountAge} gün${isNewAcc ? ' ⚠️' : ''}`, inline: true },
          { name: '👥 Üye Sayısı', value: `${guild.memberCount}`, inline: true },
          { name: '📨 Davet Eden', value: inviterId ? `<@${inviterId}> (${inviterTag})` : '`Bilinmiyor`', inline: true },
          { name: '🔗 Davet Kodu', value: usedCode ? `\`${usedCode}\`` : '`-`', inline: true },
          { name: '⭐ Davet Sayısı', value: invData ? `**${realCount}** gerçek | ${invData.total} toplam | ${invData.left} ayrılan | ${invData.fake} fake` : '`-`', inline: false },
        )
        .setFooter({ text: `Hesap oluşturulma: ${new Date(member.user.createdTimestamp).toLocaleDateString('tr-TR')}` })
        .setTimestamp();

      await logCh.send({ embeds: [joinEmbed] }).catch(() => {});
    }
  }
});

client.on('guildMemberRemove', async member => {
  const { guild } = member;
  const settings = getSettings(guild.id);

  // ── Invite Tracking - left sayacını güncelle ──────────────
  for (const [key, invData] of db.inviteData) {
    if (!key.startsWith(guild.id + '-')) continue;
    const userEntry = invData.invitedUsers.find(u => u.id === member.user.id && !u.leftAt);
    if (userEntry) {
      userEntry.leftAt = Date.now();
      invData.left++;
      break;
    }
  }

  // ── Log ───────────────────────────────────────────────────
  const logChanId = settings.davetLogChannel || settings.logChannel;
  if (logChanId) {
    const logCh = guild.channels.cache.get(logChanId);
    if (logCh) {
      // Kim davet etmişti bul
      let inviterInfo = null;
      for (const [key, invData] of db.inviteData) {
        if (!key.startsWith(guild.id + '-')) continue;
        const found = invData.invitedUsers.find(u => u.id === member.user.id);
        if (found) { inviterInfo = { inviterId: key.split('-')[1], data: invData }; break; }
      }

      const leaveEmbed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('📤 Sunucudan Ayrıldı')
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '👤 Üye', value: `${member.user.tag}`, inline: false },
          { name: '🆔 ID', value: member.user.id, inline: true },
          { name: '👥 Üye Sayısı', value: `${guild.memberCount}`, inline: true },
          { name: '📨 Davet Eden', value: inviterInfo ? `<@${inviterInfo.inviterId}>` : '`Bilinmiyor`', inline: true },
        )
        .setTimestamp();

      await logCh.send({ embeds: [leaveEmbed] }).catch(() => {});
    }
  }
});

// ════════════════════════════════════════════════════════════════
// STARBOARD
// ════════════════════════════════════════════════════════════════
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => {});
  if (reaction.message.partial) await reaction.message.fetch().catch(() => {});
  if (reaction.emoji.name !== '⭐') return;

  const settings = getSettings(reaction.message.guild?.id);
  if (!settings.starboard?.kanalId) return;

  const esik = settings.starboard.esik || 3;
  const count = reaction.count;
  if (count < esik) return;

  const msg = reaction.message;
  const sbChannel = reaction.message.guild.channels.cache.get(settings.starboard.kanalId);
  if (!sbChannel || msg.channel.id === sbChannel.id) return;

  const existingId = db.starboard.get(msg.id);
  const starEmbed = embed(0xf1c40f, null,
    msg.content || '*(görsel/dosya)*',
    [{ name: '📍 Orijinal', value: `[Mesaja git](${msg.url})`, inline: true }]
  ).setAuthor({ name: msg.author.username, iconURL: msg.author.displayAvatarURL() })
    .setFooter({ text: `⭐ ${count} • #${msg.channel.name}` });

  if (msg.attachments.first()?.url) starEmbed.setImage(msg.attachments.first().url);

  if (existingId) {
    const existing = await sbChannel.messages.fetch(existingId).catch(() => null);
    if (existing) await existing.edit({ embeds: [starEmbed] }).catch(() => {});
  } else {
    const sent = await sbChannel.send({ embeds: [starEmbed] }).catch(() => null);
    if (sent) db.starboard.set(msg.id, sent.id);
  }
});

// ════════════════════════════════════════════════════════════════
// GALERI KANALI - Sadece Görsel/Video
// ════════════════════════════════════════════════════════════════
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  const settings = getSettings(message.guild.id);
  if (!settings.galeriChannel || message.channel.id !== settings.galeriChannel) return;
  if (message.attachments.size === 0 && !message.content.match(/https?:\/\//)) {
    await message.delete().catch(() => {});
  }
});

// ════════════════════════════════════════════════════════════════
// INTERACTION HANDLER
// ════════════════════════════════════════════════════════════════
client.on('interactionCreate', async interaction => {
  const { guild, member, user } = interaction;
  const settings = getSettings(guild?.id);

  // ════════════════════════════════════════════════════════════════
  // BUTON İŞLEYİCİ
  // ════════════════════════════════════════════════════════════════
  if (interaction.isButton()) {
    const { customId } = interaction;

    // ── Ticket Aç Butonu ─────────────────────────────────────
    if (customId === 'ticket_ac') {
      const ticketSettings = settings.ticketSettings;
      if (!ticketSettings) return interaction.reply({ embeds: [err('Ticket sistemi henüz ayarlanmamış.')], ephemeral: true });

      // Zaten açık ticket var mı kontrol et
      const mevcutTicket = guild.channels.cache.find(c => c.name === `ticket-${user.username.toLowerCase().replace(/\s/g, '-')}` || c.topic === `ticket:${user.id}`);
      if (mevcutTicket) return interaction.reply({ embeds: [err(`Zaten açık bir ticketın var: ${mevcutTicket}`)], ephemeral: true });

      const kategori = guild.channels.cache.get(ticketSettings.kategoriId);
      if (!kategori) return interaction.reply({ embeds: [err('Ticket kategorisi bulunamadı.')], ephemeral: true });

      const ticketKanal = await guild.channels.create({
        name: `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20)}`,
        type: ChannelType.GuildText,
        parent: ticketSettings.kategoriId,
        topic: `ticket:${user.id}`,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: ['ViewChannel'] },
          { id: user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
          { id: ticketSettings.destekRolId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages'] },
          { id: guild.members.me.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageChannels'] },
        ],
      });

      db.tickets.set(ticketKanal.id, { userId: user.id, guildId: guild.id, createdAt: new Date() });

      const kapatRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_kapat').setLabel('🔒 Ticketı Kapat').setStyle(ButtonStyle.Danger)
      );

      await ticketKanal.send({
        content: `<@${user.id}> <@&${ticketSettings.destekRolId}>`,
        embeds: [embed(0x5865F2, '🎫 Destek Talebi Açıldı', `Merhaba ${user}, destek ekibimiz en kısa sürede seninle ilgilenecek!\n\n📌 Sorununuzu açık bir şekilde yazın.\n⏰ Ticketı işin bittikten sonra kapatmayı unutmayın.`, [
          { name: '👤 Talep Eden', value: `${user}`, inline: true },
          { name: '📅 Tarih', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
        ])],
        components: [kapatRow],
      });

      return interaction.reply({ embeds: [ok('Ticket Açıldı!', `Ticketın oluşturuldu: ${ticketKanal}`)], ephemeral: true });
    }

    // ── Ticket Bilgi Butonu ──────────────────────────────────
    if (customId === 'ticket_bilgi') {
      return interaction.reply({
        embeds: [embed(0x3498db, 'ℹ️ Destek Sistemi Hakkında', [
          '🎫 **Ticket açmak için** "Ticket Aç" butonuna tıklayın.',
          '📋 **Bir talebiniz olduğunda** açık ve net bir şekilde açıklayın.',
          '⏱️ **Ekibimiz** en kısa sürede size geri dönecektir.',
          '🔒 **Sorununuz çözülünce** ticketı kapatabilirsiniz.',
        ].join('\n'))],
        ephemeral: true,
      });
    }

    // ── Ticket Kapat Butonu ──────────────────────────────────
    if (customId === 'ticket_kapat') {
      const ticketData = db.tickets.get(interaction.channelId);
      const isDestek = settings.ticketSettings?.destekRolId ? member.roles.cache.has(settings.ticketSettings.destekRolId) : false;
      const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
      const isOwner = ticketData?.userId === user.id;

      if (!isAdmin && !isDestek && !isOwner) {
        return interaction.reply({ embeds: [err('Bu ticketı kapatma yetkin yok.')], ephemeral: true });
      }

      await interaction.reply({ embeds: [embed(0xe74c3c, '🔒 Ticket Kapatılıyor...', `Bu kanal **5 saniye** içinde silinecek.`)] });
      db.tickets.delete(interaction.channelId);
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
      return;
    }

    // ── Spawner Market Butonları ─────────────────────────────
    if (customId === 'spawner_sat' || customId === 'spawner_al' || customId === 'spawner_bilgi') {
      const sp = db.spawnerSettings.get(guild.id) || { alis: 4200000, satis: 5000000, minimum: 8 };

      if (customId === 'spawner_bilgi') {
        return interaction.reply({
          embeds: [embed(0xf39c12, 'ℹ️ Spawner Market Bilgi', [
            `📦 **Minimum İşlem:** ${sp.minimum} stack`,
            `💚 **Alış Fiyatı:** ${sp.alis.toLocaleString('tr-TR')} / stack`,
            `❤️ **Satış Fiyatı:** ${sp.satis.toLocaleString('tr-TR')} / stack`,
            '',
            '⚠️ Fiyatlar piyasaya göre değişebilir.',
            '📩 İşlem yapmak için bir kategori seçin.',
          ].join('\n'))],
          ephemeral: true,
        });
      }

      if (customId === 'spawner_sat') {
        return interaction.reply({
          embeds: [embed(0x2ecc71, '💚 Spawner Satmak İstiyorum', [
            `**Alış Fiyatımız:** ${sp.alis.toLocaleString('tr-TR')} / stack`,
            `**Minimum:** ${sp.minimum} stack`,
            '',
            '📋 **İşlem için:**',
            '> 1. Spawner miktarını belirtin',
            '> 2. Yetkili ile iletişime geçin',
            '> 3. Ödeme alın',
          ].join('\n'))],
          ephemeral: true,
        });
      }

      if (customId === 'spawner_al') {
        return interaction.reply({
          embeds: [embed(0xe74c3c, '❤️ Spawner Almak İstiyorum', [
            `**Satış Fiyatımız:** ${sp.satis.toLocaleString('tr-TR')} / stack`,
            `**Minimum:** ${sp.minimum} stack`,
            '',
            '📋 **İşlem için:**',
            '> 1. Almak istediğiniz miktarı belirtin',
            '> 2. Yetkili ile iletişime geçin',
            '> 3. Ödeme yapın ve spawneri alın',
          ].join('\n'))],
          ephemeral: true,
        });
      }
    }

    // ── Doğrulama Butonu ────────────────────────────────────
    if (customId === 'dogrulama_onayla') {
      const dogSettings = settings.dogrulamaSettings;
      if (!dogSettings) return interaction.reply({ embeds: [err('Doğrulama sistemi ayarlanmamış.')], ephemeral: true });
      const rol = guild.roles.cache.get(dogSettings.rolId);
      if (!rol) return interaction.reply({ embeds: [err('Doğrulama rolü bulunamadı.')], ephemeral: true });
      if (member.roles.cache.has(dogSettings.rolId))
        return interaction.reply({ embeds: [info('Zaten Doğrulandın', 'Zaten doğrulanmış durumdasın.')], ephemeral: true });
      await member.roles.add(rol).catch(() => {});
      return interaction.reply({ embeds: [ok('✅ Doğrulandın!', `${rol} rolü verildi. Sunucuya hoş geldin!`)], ephemeral: true });
    }

    // ── Çekiliş Katılım Butonu ───────────────────────────────
    if (customId.startsWith('giveaway_join_')) {
      const msgId = customId.replace('giveaway_join_', '');
      const giveaway = db.giveaways.get(msgId);
      if (!giveaway || giveaway.ended)
        return interaction.reply({ embeds: [err('Bu çekiliş sona erdi.')], ephemeral: true });
      if (giveaway.entries.includes(user.id))
        return interaction.reply({ embeds: [warn('Zaten Katıldın', 'Bu çekilişe zaten katıldın.')], ephemeral: true });
      giveaway.entries.push(user.id);
      // Butonun üstündeki sayıyı güncelle
      try {
        const ch = guild.channels.cache.get(giveaway.channelId);
        const msg = await ch?.messages.fetch(msgId).catch(() => null);
        if (msg) {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`giveaway_join_${msgId}`).setLabel(`🎉 Katıl (${giveaway.entries.length})`).setStyle(ButtonStyle.Success)
          );
          await msg.edit({ components: [row] }).catch(() => {});
        }
      } catch(e) {}
      return interaction.reply({ embeds: [ok('🎉 Katıldın!', `**${giveaway.prize}** çekilişine katıldın! Bol şans!`)], ephemeral: true });
    }

    // ── Anket Oylaması ───────────────────────────────────────
    if (customId.startsWith('poll_')) {
      const parts = customId.split('_');
      const pollMsgId = parts[1];
      const optionIdx = parseInt(parts[2]);
      const poll = db.polls.get(pollMsgId);
      if (!poll) return interaction.reply({ embeds: [err('Anket bulunamadı.')], ephemeral: true });
      poll.votes.set(user.id, optionIdx);
      // Oy sayılarını hesapla
      const counts = poll.options.map((_, i) => [...poll.votes.values()].filter(v => v === i).length);
      const total = poll.votes.size;
      const fields = poll.options.map((opt, i) => {
        const bar = total > 0 ? '█'.repeat(Math.round((counts[i] / total) * 10)) + '░'.repeat(10 - Math.round((counts[i] / total) * 10)) : '░░░░░░░░░░';
        return { name: `${['🅰️','🅱️','🇨','🇩'][i]} ${opt}`, value: `\`${bar}\` **${counts[i]}** oy (${total > 0 ? Math.round((counts[i]/total)*100) : 0}%)`, inline: false };
      });
      try {
        const ch = guild.channels.cache.get(poll.channelId);
        const msg = await ch?.messages.fetch(pollMsgId).catch(() => null);
        if (msg) await msg.edit({ embeds: [embed(0x3498db, `📊 ${poll.question}`, `**Toplam:** ${total} oy`, fields)] }).catch(() => {});
      } catch(e) {}
      return interaction.reply({ embeds: [ok('Oyun Kaydedildi', `**${poll.options[optionIdx]}** seçeneğine oy verdin.`)], ephemeral: true });
    }

    // ── Rol Seçici Butonları ─────────────────────────────────
    if (customId.startsWith('rolsec_')) {
      const roleId = customId.replace('rolsec_', '');
      const rol = guild.roles.cache.get(roleId);
      if (!rol) return interaction.reply({ embeds: [err('Rol bulunamadı.')], ephemeral: true });
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(rol).catch(() => {});
        return interaction.reply({ embeds: [warn('Rol Alındı', `**${rol.name}** rolü kaldırıldı.`)], ephemeral: true });
      } else {
        await member.roles.add(rol).catch(() => {});
        return interaction.reply({ embeds: [ok('Rol Verildi', `**${rol.name}** rolü verildi!`)], ephemeral: true });
      }
    }

    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // Yasaklı komut kontrolü
  if (settings.yasakliKomutlar?.includes(commandName)) {
    return interaction.reply({ embeds: [err('Bu komut bu sunucuda devre dışı bırakılmıştır.')], ephemeral: true });
  }

  // ── Admin/Görevli gerektiren komutlar ──────────────────────
  const ADMIN_KOMUTLAR = ['ban','kick','mute','unmute','warn','uyarilar','temizle','isim-duzeltme','isimdegistir','yasakli-kelime','yasakli-komut','yavasmod','log','loglar','galeri','oneri','oto-rol','prefix','tecrubemiktar','rankmuaf','seviyeatla-mesaj','rank-ayar','seviye-rol','gorevli','rankboost','davet-bonus','davetlog','davet-rol','davet-sifirla','bildirim','ozelkomut-ekle','ozeloda','emoji','konustur','clyde','embed','ticket-kur','spawner-market-kur','spawner-fiyat','para-ver','para-al','cekilisbaslat','cekilisbitir','cekilistekrar','dogrulama-kur','starboard-kur','rol-secici','antispam'];

  if (ADMIN_KOMUTLAR.includes(commandName)) {
    const isAdmin  = member.permissions.has(PermissionFlagsBits.Administrator);
    const isOwner  = guild.ownerId === user.id;
    const isGorevli = settings.gorevliRol ? member.roles.cache.has(settings.gorevliRol) : false;

    if (!isAdmin && !isOwner && !isGorevli) {
      return interaction.reply({
        embeds: [embed(Colors.error, '🚫 Yetersiz Yetki', 'Bu komutu kullanmak için **Yönetici** yetkisine veya **Görevli** rolüne ihtiyacın var.')],
        ephemeral: true
      });
    }
  }

  try {

    // ── /ban ──────────────────────────────────────────────────
    if (commandName === 'ban') {
      const target = interaction.options.getMember('kullanici');
      const reason = interaction.options.getString('sebep') || 'Sebep belirtilmedi';
      if (!target) return interaction.reply({ embeds: [err('Kullanıcı bulunamadı.')], ephemeral: true });
      if (!target.bannable) return interaction.reply({ embeds: [err('Bu kullanıcıyı banlayamam.')], ephemeral: true });
      await target.send({ embeds: [err(`**${guild.name}** sunucusundan banlandınız.\n**Sebep:** ${reason}`)] }).catch(() => {});
      await target.ban({ reason });
      await interaction.reply({ embeds: [ok('Kullanıcı Banlandı', `${target.user.tag} banlandı.\n**Sebep:** ${reason}`)] });
      sendLog(guild, settings, ok('🔨 Ban', `**Kullanıcı:** ${target.user.tag}\n**Mod:** ${user.tag}\n**Sebep:** ${reason}`));
    }

    // ── /kick ─────────────────────────────────────────────────
    else if (commandName === 'kick') {
      const target = interaction.options.getMember('kullanici');
      const reason = interaction.options.getString('sebep') || 'Sebep belirtilmedi';
      if (!target) return interaction.reply({ embeds: [err('Kullanıcı bulunamadı.')], ephemeral: true });
      if (!target.kickable) return interaction.reply({ embeds: [err('Bu kullanıcıyı atamam.')], ephemeral: true });
      await target.send({ embeds: [info('Sunucudan Atıldınız', `**${guild.name}**\n**Sebep:** ${reason}`)] }).catch(() => {});
      await target.kick(reason);
      await interaction.reply({ embeds: [ok('Kullanıcı Atıldı', `${target.user.tag} atıldı.\n**Sebep:** ${reason}`)] });
      sendLog(guild, settings, ok('👢 Kick', `**Kullanıcı:** ${target.user.tag}\n**Mod:** ${user.tag}\n**Sebep:** ${reason}`));
    }

    // ── /mute ─────────────────────────────────────────────────
    else if (commandName === 'mute') {
      const target = interaction.options.getMember('kullanici');
      const minutes = interaction.options.getInteger('sure');
      const reason = interaction.options.getString('sebep') || 'Sebep belirtilmedi';
      if (!target) return interaction.reply({ embeds: [err('Kullanıcı bulunamadı.')], ephemeral: true });
      await target.timeout(minutes * 60000, reason);
      await interaction.reply({ embeds: [ok('Kullanıcı Susturuldu', `${target.user.tag} **${minutes} dakika** susturuldu.\n**Sebep:** ${reason}`)] });
      sendLog(guild, settings, warn('🔇 Mute', `**Kullanıcı:** ${target.user.tag}\n**Süre:** ${minutes} dakika\n**Mod:** ${user.tag}\n**Sebep:** ${reason}`));
    }

    // ── /unmute ───────────────────────────────────────────────
    else if (commandName === 'unmute') {
      const target = interaction.options.getMember('kullanici');
      if (!target) return interaction.reply({ embeds: [err('Kullanıcı bulunamadı.')], ephemeral: true });
      await target.timeout(null);
      await interaction.reply({ embeds: [ok('Susturma Kaldırıldı', `${target.user.tag} artık konuşabilir.`)] });
    }

    // ── /warn ─────────────────────────────────────────────────
    else if (commandName === 'warn') {
      const target = interaction.options.getMember('kullanici');
      const reason = interaction.options.getString('sebep');
      if (!target) return interaction.reply({ embeds: [err('Kullanıcı bulunamadı.')], ephemeral: true });
      const count = addWarning(guild.id, target.user.id, reason, user.tag);
      await target.send({ embeds: [warn('⚠️ Uyarı Aldınız', `**${guild.name}**\n**Sebep:** ${reason}\n**Toplam Uyarı:** ${count}`)] }).catch(() => {});
      await interaction.reply({ embeds: [warn('Uyarı Verildi', `${target.user.tag} uyarıldı.\n**Sebep:** ${reason}\n**Toplam:** ${count}`)] });
      sendLog(guild, settings, warn('⚠️ Uyarı', `**Kullanıcı:** ${target.user.tag}\n**Mod:** ${user.tag}\n**Sebep:** ${reason}\n**Toplam:** ${count}`));
    }

    // ── /uyarilar ─────────────────────────────────────────────
    else if (commandName === 'uyarilar') {
      const targetUser = interaction.options.getUser('kullanici');
      const warns = getWarnings(guild.id, targetUser.id);
      if (warns.length === 0) return interaction.reply({ embeds: [info('Uyarılar', `${targetUser.tag} kullanıcısının uyarısı yok.`)] });
      const list = warns.map((w, i) => `**${i + 1}.** ${w.reason} — *${w.mod}*`).join('\n');
      await interaction.reply({ embeds: [warn(`${targetUser.tag} — Uyarılar (${warns.length})`, list)] });
    }

    // ── /temizle ──────────────────────────────────────────────
    else if (commandName === 'temizle') {
      const amount = interaction.options.getInteger('sayi');
      const deleted = await interaction.channel.bulkDelete(amount, true);
      const reply = await interaction.reply({ embeds: [ok('Temizlendi', `**${deleted.size}** mesaj silindi.`)], fetchReply: true });
      setTimeout(() => reply.delete().catch(() => {}), 4000);
    }

    // ── /isim-duzeltme / /isimdeğiştir ───────────────────────
    else if (commandName === 'isim-duzeltme' || commandName === 'isimdeğiştir') {
      const target = interaction.options.getMember('kullanici');
      const yeniAd = interaction.options.getString('yeniad');
      if (!target) return interaction.reply({ embeds: [err('Kullanıcı bulunamadı.')], ephemeral: true });
      await target.setNickname(yeniAd);
      await interaction.reply({ embeds: [ok('İsim Değiştirildi', `${target.user.tag} → **${yeniAd}**`)] });
    }

    // ── /yasakli-kelime ───────────────────────────────────────
    else if (commandName === 'yasakli-kelime') {
      const islem = interaction.options.getString('islem');
      const kelime = interaction.options.getString('kelime')?.toLowerCase();
      if (!settings.yasakliKelimeler) settings.yasakliKelimeler = [];
      if (islem === 'ekle') {
        if (!kelime) return interaction.reply({ embeds: [err('Kelime giriniz.')], ephemeral: true });
        if (!settings.yasakliKelimeler.includes(kelime)) settings.yasakliKelimeler.push(kelime);
        await interaction.reply({ embeds: [ok('Kelime Eklendi', `\`${kelime}\` yasaklı kelimeler listesine eklendi.`)] });
      } else if (islem === 'sil') {
        settings.yasakliKelimeler = settings.yasakliKelimeler.filter(k => k !== kelime);
        await interaction.reply({ embeds: [ok('Kelime Silindi', `\`${kelime}\` listeden kaldırıldı.`)] });
      } else {
        const list = settings.yasakliKelimeler.length ? settings.yasakliKelimeler.map(k => `\`${k}\``).join(', ') : 'Liste boş.';
        await interaction.reply({ embeds: [info('Yasaklı Kelimeler', list)], ephemeral: true });
      }
    }

    // ── /yasakli-komut ────────────────────────────────────────
    else if (commandName === 'yasakli-komut') {
      const islem = interaction.options.getString('islem');
      const komut = interaction.options.getString('komut')?.toLowerCase();
      if (!settings.yasakliKomutlar) settings.yasakliKomutlar = [];
      if (islem === 'ekle') {
        if (!komut) return interaction.reply({ embeds: [err('Komut adı giriniz.')], ephemeral: true });
        if (!settings.yasakliKomutlar.includes(komut)) settings.yasakliKomutlar.push(komut);
        await interaction.reply({ embeds: [ok('Komut Yasaklandı', `\`/${komut}\` bu sunucuda devre dışı bırakıldı.`)] });
      } else if (islem === 'sil') {
        settings.yasakliKomutlar = settings.yasakliKomutlar.filter(k => k !== komut);
        await interaction.reply({ embeds: [ok('Komut Aktifleştirildi', `\`/${komut}\` tekrar aktif.`)] });
      } else {
        const list = settings.yasakliKomutlar.length ? settings.yasakliKomutlar.map(k => `\`/${k}\``).join(', ') : 'Liste boş.';
        await interaction.reply({ embeds: [info('Yasaklı Komutlar', list)], ephemeral: true });
      }
    }

    // ── /yavasmod ─────────────────────────────────────────────
    else if (commandName === 'yavasmod') {
      const saniye = interaction.options.getInteger('saniye');
      await interaction.channel.setRateLimitPerUser(saniye);
      await interaction.reply({ embeds: [ok('Yavaş Mod', saniye === 0 ? 'Yavaş mod kapatıldı.' : `Yavaş mod **${saniye} saniye** olarak ayarlandı.`)] });
    }

    // ── /log ──────────────────────────────────────────────────
    else if (commandName === 'log') {
      const kanal = interaction.options.getChannel('kanal');
      settings.logChannel = kanal.id;
      await interaction.reply({ embeds: [ok('Log Kanalı Ayarlandı', `Log kanalı ${kanal} olarak ayarlandı.`)] });
    }

    // ── /loglar ───────────────────────────────────────────────
    else if (commandName === 'loglar') {
      const logCh = settings.logChannel ? `<#${settings.logChannel}>` : 'Ayarlanmamış';
      const galeriCh = settings.galeriChannel ? `<#${settings.galeriChannel}>` : 'Ayarlanmamış';
      const oneriCh = settings.oneriChannel ? `<#${settings.oneriChannel}>` : 'Ayarlanmamış';
      await interaction.reply({
        embeds: [info('Log Ayarları', null, [
          { name: '📋 Log Kanalı', value: logCh, inline: true },
          { name: '🖼️ Galeri Kanalı', value: galeriCh, inline: true },
          { name: '💡 Öneri Kanalı', value: oneriCh, inline: true },
        ])], ephemeral: true
      });
    }

    // ── /galeri ───────────────────────────────────────────────
    else if (commandName === 'galeri') {
      const kanal = interaction.options.getChannel('kanal');
      settings.galeriChannel = kanal.id;
      await interaction.reply({ embeds: [ok('Galeri Kanalı Ayarlandı', `Galeri kanalı ${kanal} olarak ayarlandı. Sadece görsel/link paylaşılabilecek.`)] });
    }

    // ── /oneri ────────────────────────────────────────────────
    else if (commandName === 'oneri') {
      const kanal = interaction.options.getChannel('kanal');
      settings.oneriChannel = kanal.id;
      await interaction.reply({ embeds: [ok('Öneri Kanalı Ayarlandı', `Öneri kanalı ${kanal} olarak ayarlandı.`)] });
    }

    // ── /oto-rol ──────────────────────────────────────────────
    else if (commandName === 'oto-rol') {
      const rol = interaction.options.getRole('rol');
      settings.autoRole = rol.id;
      await interaction.reply({ embeds: [ok('Oto Rol Ayarlandı', `Yeni üyeler ${rol} rolünü alacak.`)] });
    }

    // ── /prefix ───────────────────────────────────────────────
    else if (commandName === 'prefix') {
      const prefix = interaction.options.getString('prefix');
      settings.prefix = prefix;
      await interaction.reply({ embeds: [ok('Prefix Ayarlandı', `Bot prefix'i \`${prefix}\` olarak güncellendi.`)] });
    }

    // ── /tecrubemiktar ────────────────────────────────────────
    else if (commandName === 'tecrubemiktar') {
      const miktar = interaction.options.getInteger('miktar');
      settings.xpPerMsg = miktar;
      await interaction.reply({ embeds: [ok('XP Miktarı Ayarlandı', `Mesaj başına **${miktar} XP** kazanılacak.`)] });
    }

    // ── /rankmuaf ─────────────────────────────────────────────
    else if (commandName === 'rankmuaf') {
      const tip = interaction.options.getString('tip');
      const islem = interaction.options.getString('islem');
      if (!db.xpExempt.has(guild.id)) db.xpExempt.set(guild.id, { channels: [], roles: [] });
      const exempt = db.xpExempt.get(guild.id);
      if (tip === 'kanal') {
        const kanal = interaction.options.getChannel('kanal');
        if (!kanal) return interaction.reply({ embeds: [err('Kanal seçiniz.')], ephemeral: true });
        if (islem === 'ekle') { if (!exempt.channels.includes(kanal.id)) exempt.channels.push(kanal.id); }
        else exempt.channels = exempt.channels.filter(c => c !== kanal.id);
        await interaction.reply({ embeds: [ok('Rank Muaf', `${kanal} kanalı ${islem === 'ekle' ? 'muaf listeye eklendi' : 'listeden çıkarıldı'}.`)] });
      } else {
        const rol = interaction.options.getRole('rol');
        if (!rol) return interaction.reply({ embeds: [err('Rol seçiniz.')], ephemeral: true });
        if (islem === 'ekle') { if (!exempt.roles.includes(rol.id)) exempt.roles.push(rol.id); }
        else exempt.roles = exempt.roles.filter(r => r !== rol.id);
        await interaction.reply({ embeds: [ok('Rank Muaf', `${rol} rolü ${islem === 'ekle' ? 'muaf listeye eklendi' : 'listeden çıkarıldı'}.`)] });
      }
    }

    // ── /rank-ayar ────────────────────────────────────────────
    else if (commandName === 'rank-ayar') {
      const aktif = interaction.options.getBoolean('aktif');
      settings.rankAktif = aktif;
      await interaction.reply({ embeds: [ok('Rank Sistemi', `Rank sistemi **${aktif ? 'aktif' : 'devre dışı'}**.`)] });
    }

    // ── /seviyeatla-mesaj ─────────────────────────────────────
    else if (commandName === 'seviyeatla-mesaj') {
      const mesaj = interaction.options.getString('mesaj');
      settings.seviyeAtlamaMesaji = mesaj;
      await interaction.reply({ embeds: [ok('Seviye Atlama Mesajı', `Mesaj ayarlandı:\n${mesaj}`)] });
    }

    // ── /gorevli ──────────────────────────────────────────────
    else if (commandName === 'gorevli') {
      const rol = interaction.options.getRole('rol');
      settings.gorevliRol = rol.id;
      await interaction.reply({ embeds: [ok('Görevli Rolü Ayarlandı', `${rol} görevi üstlenecek.`)] });
    }

    // ── /userinfo ─────────────────────────────────────────────
    else if (commandName === 'userinfo') {
      const targetUser = interaction.options.getUser('kullanici') || user;
      const targetMember = guild.members.cache.get(targetUser.id);
      const warns = getWarnings(guild.id, targetUser.id);
      const xpData = getXP(guild.id, targetUser.id);
      const roles = targetMember?.roles.cache.filter(r => r.id !== guild.id).map(r => r.toString()).join(', ') || 'Yok';
      await interaction.reply({
        embeds: [embed(Colors.purple, `👤 ${targetUser.tag}`, null, [
          { name: '🆔 ID', value: targetUser.id, inline: true },
          { name: '🤖 Bot', value: targetUser.bot ? 'Evet' : 'Hayır', inline: true },
          { name: '📅 Hesap Oluşturulma', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '📥 Sunucuya Katılma', value: targetMember ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:R>` : 'Bilinmiyor', inline: true },
          { name: '⚠️ Uyarı', value: `${warns.length}`, inline: true },
          { name: '⭐ Seviye', value: `${xpData.level} (${xpData.xp} XP)`, inline: true },
          { name: '🎭 Roller', value: roles.length > 1000 ? roles.slice(0, 1000) + '...' : roles || 'Yok' },
        ]).setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
      ]});
    }

    // ── /avatar ───────────────────────────────────────────────
    else if (commandName === 'avatar') {
      const targetUser = interaction.options.getUser('kullanici') || user;
      await interaction.reply({
        embeds: [embed(Colors.purple, `🖼️ ${targetUser.tag} — Avatar`, null)
          .setImage(targetUser.displayAvatarURL({ size: 1024, dynamic: true }))]
      });
    }

    // ── /sunucu ───────────────────────────────────────────────
    else if (commandName === 'sunucu') {
      await interaction.reply({
        embeds: [embed(Colors.teal, `🏠 ${guild.name}`, null, [
          { name: '👑 Sahip', value: `<@${guild.ownerId}>`, inline: true },
          { name: '👥 Üye', value: `${guild.memberCount}`, inline: true },
          { name: '📢 Kanal', value: `${guild.channels.cache.size}`, inline: true },
          { name: '🎭 Rol', value: `${guild.roles.cache.size}`, inline: true },
          { name: '😀 Emoji', value: `${guild.emojis.cache.size}`, inline: true },
          { name: '📅 Oluşturulma', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '🆔 ID', value: guild.id, inline: true },
          { name: '🔒 Doğrulama', value: guild.verificationLevel.toString(), inline: true },
        ]).setThumbnail(guild.iconURL({ size: 256 }))
      ]});
    }

    // ── /roller ───────────────────────────────────────────────
    else if (commandName === 'roller') {
      const roles = guild.roles.cache.filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position).map(r => r.toString()).join(', ');
      await interaction.reply({
        embeds: [info('🎭 Sunucu Rolleri', roles.length > 4000 ? roles.slice(0, 4000) + '...' : roles || 'Rol yok')], ephemeral: true
      });
    }

    // ── /id ───────────────────────────────────────────────────
    else if (commandName === 'id') {
      const nesne = interaction.options.getString('nesne');
      const rol = guild.roles.cache.find(r => r.name.toLowerCase() === nesne.toLowerCase());
      const kanal = guild.channels.cache.find(c => c.name.toLowerCase() === nesne.toLowerCase());
      const uye = guild.members.cache.find(m => m.user.username.toLowerCase() === nesne.toLowerCase() || m.displayName.toLowerCase() === nesne.toLowerCase());
      let results = [];
      if (rol) results.push(`🎭 Rol: **${rol.name}** → \`${rol.id}\``);
      if (kanal) results.push(`📢 Kanal: **${kanal.name}** → \`${kanal.id}\``);
      if (uye) results.push(`👤 Üye: **${uye.user.tag}** → \`${uye.id}\``);
      await interaction.reply({ embeds: [info('🔍 ID Arama', results.length ? results.join('\n') : 'Sonuç bulunamadı.')], ephemeral: true });
    }

    // ── /shard ────────────────────────────────────────────────
    else if (commandName === 'shard') {
      await interaction.reply({
        embeds: [info('⚙️ Shard Bilgisi', null, [
          { name: 'Shard ID', value: `${client.shard?.ids[0] ?? 0}`, inline: true },
          { name: 'Sunucu Sayısı', value: `${client.guilds.cache.size}`, inline: true },
          { name: 'Ping', value: `${client.ws.ping}ms`, inline: true },
        ])]
      });
    }

    // ── /istatistik ───────────────────────────────────────────
    else if (commandName === 'istatistik') {
      const uptime = process.uptime();
      const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60), s = Math.floor(uptime % 60);
      await interaction.reply({
        embeds: [info('📊 Bot İstatistikleri', null, [
          { name: '🏠 Sunucu', value: `${client.guilds.cache.size}`, inline: true },
          { name: '👥 Kullanıcı', value: `${client.users.cache.size}`, inline: true },
          { name: '📡 Ping', value: `${client.ws.ping}ms`, inline: true },
          { name: '⏱️ Uptime', value: `${h}s ${m}dk ${s}sn`, inline: true },
          { name: '💾 RAM', value: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`, inline: true },
          { name: '📌 Node.js', value: process.version, inline: true },
        ])]
      });
    }

    // ── /rank ─────────────────────────────────────────────────
    else if (commandName === 'rank') {
      const targetUser = interaction.options.getUser('kullanici') || user;
      const xpData = getXP(guild.id, targetUser.id);
      const needed = xpData.level * 100;
      const bar = '█'.repeat(Math.floor((xpData.xp / needed) * 20)) + '░'.repeat(20 - Math.floor((xpData.xp / needed) * 20));
      await interaction.reply({
        embeds: [embed(Colors.gold, `⭐ ${targetUser.tag} — Rank`, null, [
          { name: '🏆 Seviye', value: `${xpData.level}`, inline: true },
          { name: '✨ XP', value: `${xpData.xp} / ${needed}`, inline: true },
          { name: '📊 İlerleme', value: `\`${bar}\``, inline: false },
        ]).setThumbnail(targetUser.displayAvatarURL({ size: 128 }))]
      });
    }

    // ── /rankboost ────────────────────────────────────────────
    else if (commandName === 'rankboost') {
      const target = interaction.options.getUser('kullanici');
      const miktar = interaction.options.getInteger('miktar');
      const result = addXP(guild.id, target.id, miktar);
      await interaction.reply({ embeds: [ok('XP Eklendi', `${target.tag} kullanıcısına **+${miktar} XP** eklendi.\n**Mevcut:** ${result.xp} XP (Seviye ${result.level})`)] });
    }

    // ── /top ──────────────────────────────────────────────────
    else if (commandName === 'top') {
      const allXP = [...db.xp.entries()]
        .filter(([k]) => k.startsWith(guild.id))
        .sort((a, b) => (b[1].level * 10000 + b[1].xp) - (a[1].level * 10000 + a[1].xp))
        .slice(0, 10);
      const list = allXP.map(([k, v], i) => {
        const userId = k.split('-')[1];
        return `**${i + 1}.** <@${userId}> — Seviye ${v.level} (${v.xp} XP)`;
      }).join('\n') || 'Henüz veri yok.';
      await interaction.reply({ embeds: [embed(Colors.gold, '🏆 XP Sıralaması', list)] });
    }

    // ── /ship ─────────────────────────────────────────────────
    else if (commandName === 'ship') {
      const k1 = interaction.options.getUser('kisi1');
      const k2 = interaction.options.getUser('kisi2') || user;
      const oran = Math.floor(Math.random() * 101);
      const bar = '❤️'.repeat(Math.floor(oran / 10)) + '🖤'.repeat(10 - Math.floor(oran / 10));
      let durum = oran >= 80 ? '💍 Evlenin artık!' : oran >= 60 ? '💕 Çok uyumlular!' : oran >= 40 ? '😊 Fena değil!' : oran >= 20 ? '🤔 Biraz zorlanırlar.' : '💔 Hiç uyuşmuyorlar.';
      await interaction.reply({ embeds: [embed(Colors.error, '💘 Uyum Ölçer', `**${k1.username}** ❤️ **${k2.username}**\n\n${bar}\n\n**%${oran}** uyum — ${durum}`)] });
    }

    // ── /qr ───────────────────────────────────────────────────
    else if (commandName === 'qr') {
      const metin = interaction.options.getString('metin');
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(metin)}`;
      await interaction.reply({ embeds: [embed(Colors.info, '📱 QR Kod', `\`${metin}\``).setImage(url)] });
    }

    // ── /renk ─────────────────────────────────────────────────
    else if (commandName === 'renk') {
      const hex = interaction.options.getString('hex').replace('#', '');
      const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
      if (isNaN(r) || isNaN(g) || isNaN(b)) return interaction.reply({ embeds: [err('Geçersiz HEX kodu.')], ephemeral: true });
      await interaction.reply({
        embeds: [embed(parseInt(hex, 16), `🎨 #${hex.toUpperCase()}`, null, [
          { name: 'HEX', value: `#${hex.toUpperCase()}`, inline: true },
          { name: 'RGB', value: `rgb(${r}, ${g}, ${b})`, inline: true },
          { name: 'Önizleme', value: `https://singlecolorimage.com/get/${hex}/200x50`, inline: false },
        ])]
      });
    }

    // ── /tersçevir ────────────────────────────────────────────
    else if (commandName === 'tersçevir') {
      const metin = interaction.options.getString('metin');
      await interaction.reply({ embeds: [info('🔄 Ters Çevrildi', metin.split('').reverse().join(''))] });
    }

    // ── /pankart ──────────────────────────────────────────────
    else if (commandName === 'pankart') {
      const metin = interaction.options.getString('metin');
      const url = `https://api.memegen.link/images/custom/_/${encodeURIComponent(metin)}.png?font=impact`;
      await interaction.reply({ embeds: [embed(Colors.teal, '📢 Pankart', metin).setImage(url)] });
    }

    // ── /surecevir ────────────────────────────────────────────
    else if (commandName === 'surecevir') {
      const saniye = interaction.options.getInteger('saniye');
      const g = Math.floor(saniye / 86400), s = Math.floor((saniye % 86400) / 3600), dk = Math.floor((saniye % 3600) / 60), sn = saniye % 60;
      await interaction.reply({ embeds: [info('⏱️ Süre Çevirici', `**${saniye}** saniye = **${g}g ${s}s ${dk}dk ${sn}sn**`)] });
    }

    // ── /doviz ────────────────────────────────────────────────
    else if (commandName === 'doviz') {
      const para = interaction.options.getString('para').toUpperCase();
      try {
        const res = await fetch(`https://open.er-api.com/v6/latest/${para}`);
        const data = await res.json();
        if (data.result !== 'success') return interaction.reply({ embeds: [err('Geçersiz para birimi.')], ephemeral: true });
        const rates = ['USD', 'EUR', 'GBP', 'TRY', 'JPY', 'CHF'].filter(r => r !== para)
          .map(r => `**${r}:** ${data.rates[r]?.toFixed(4) || 'N/A'}`).join('\n');
        await interaction.reply({ embeds: [embed(Colors.gold, `💱 ${para} Döviz Kuru`, rates)] });
      } catch {
        await interaction.reply({ embeds: [err('Döviz verisi alınamadı.')], ephemeral: true });
      }
    }

    // ── /clyde ────────────────────────────────────────────────
    else if (commandName === 'clyde') {
      const mesaj = interaction.options.getString('mesaj');
      await interaction.reply({ content: '✅ Gönderildi.', ephemeral: true });
      await interaction.channel.send({
        embeds: [embed(Colors.info, null, mesaj).setAuthor({ name: 'Clyde', iconURL: 'https://cdn.discordapp.com/embed/avatars/0.png' })]
      });
    }

    // ── /konustur ─────────────────────────────────────────────
    else if (commandName === 'konustur') {
      const target = interaction.options.getUser('kullanici');
      const mesaj = interaction.options.getString('mesaj');
      await target.send({ embeds: [info('📩 Mesaj', mesaj)] }).catch(() => {});
      await interaction.reply({ embeds: [ok('Mesaj Gönderildi', `${target.tag} kullanıcısına DM gönderildi.`)], ephemeral: true });
    }

    // ── /embed ────────────────────────────────────────────────
    else if (commandName === 'embed') {
      const baslik = interaction.options.getString('baslik');
      const icerik = interaction.options.getString('icerik');
      const renkHex = interaction.options.getString('renk')?.replace('#', '') || '3498db';
      const kanal = interaction.options.getChannel('kanal') || interaction.channel;
      const renk = parseInt(renkHex, 16) || Colors.info;
      const e = embed(renk, baslik, icerik);
      await kanal.send({ embeds: [e] });
      await interaction.reply({ embeds: [ok('Embed Gönderildi', `${kanal} kanalına gönderildi.`)], ephemeral: true });
    }

    // ── /rep ──────────────────────────────────────────────────
    else if (commandName === 'rep') {
      const target = interaction.options.getUser('kullanici');
      if (target.id === user.id) return interaction.reply({ embeds: [err('Kendinize rep veremezsiniz.')], ephemeral: true });
      const key = `${guild.id}-${user.id}`;
      const now = Date.now();
      if (!db.reps.has(key)) db.reps.set(key, { count: 0, lastGiven: 0 });
      const repData = db.reps.get(key);
      if (now - repData.lastGiven < 86400000) {
        const kalan = Math.ceil((86400000 - (now - repData.lastGiven)) / 3600000);
        return interaction.reply({ embeds: [err(`Tekrar rep vermek için **${kalan} saat** beklemeniz gerekiyor.`)], ephemeral: true });
      }
      repData.lastGiven = now;
      const tKey = `${guild.id}-${target.id}`;
      if (!db.reps.has(tKey)) db.reps.set(tKey, { count: 0, lastGiven: 0 });
      db.reps.get(tKey).count++;
      await interaction.reply({ embeds: [ok('Rep Verildi', `${target.tag} kullanıcısına rep verdiniz!\n**Toplam Rep:** ${db.reps.get(tKey).count}`)] });
    }

    // ── /profil ───────────────────────────────────────────────
    else if (commandName === 'profil') {
      const targetUser = interaction.options.getUser('kullanici') || user;
      const xpData = getXP(guild.id, targetUser.id);
      const warns = getWarnings(guild.id, targetUser.id);
      const repData = db.reps.get(`${guild.id}-${targetUser.id}`);
      const bday = db.birthdays.get(`${guild.id}-${targetUser.id}`);
      await interaction.reply({
        embeds: [embed(Colors.purple, `👤 ${targetUser.tag} — Profil`, null, [
          { name: '⭐ Seviye', value: `${xpData.level}`, inline: true },
          { name: '✨ XP', value: `${xpData.xp}`, inline: true },
          { name: '👍 Rep', value: `${repData?.count || 0}`, inline: true },
          { name: '⚠️ Uyarı', value: `${warns.length}`, inline: true },
          { name: '🎂 Doğum Günü', value: bday || 'Belirtilmemiş', inline: true },
        ]).setThumbnail(targetUser.displayAvatarURL({ size: 256 }))]
      });
    }

    // ── /dogumgunu ────────────────────────────────────────────
    else if (commandName === 'dogumgunu') {
      const islem = interaction.options.getString('islem');
      if (islem === 'ayarla') {
        const tarih = interaction.options.getString('tarih');
        if (!tarih || !/^\d{2}-\d{2}$/.test(tarih)) return interaction.reply({ embeds: [err('Geçerli format: GG-AA (örn: 15-03)')], ephemeral: true });
        db.birthdays.set(`${guild.id}-${user.id}`, tarih);
        await interaction.reply({ embeds: [ok('Doğum Günü Ayarlandı', `Doğum günün **${tarih}** olarak kaydedildi.`)] });
      } else {
        const targetUser = user;
        const bday = db.birthdays.get(`${guild.id}-${targetUser.id}`);
        await interaction.reply({ embeds: [info('🎂 Doğum Günü', bday ? `${targetUser.tag} — **${bday}**` : 'Doğum günü belirtilmemiş.')] });
      }
    }

    // ── /hatirlatici ──────────────────────────────────────────
    else if (commandName === 'hatirlatici') {
      const dakika = interaction.options.getInteger('dakika');
      const mesaj = interaction.options.getString('mesaj');
      await interaction.reply({ embeds: [ok('Hatırlatıcı Kuruldu', `**${dakika} dakika** sonra seni hatırlatacağım!\n**Mesaj:** ${mesaj}`)] });
      setTimeout(async () => {
        await user.send({ embeds: [warn('⏰ Hatırlatıcı', mesaj)] }).catch(() => {});
      }, dakika * 60000);
    }

    // ── /katilim ──────────────────────────────────────────────
    else if (commandName === 'katilim') {
      await interaction.deferReply();
      const members = await guild.members.fetch();
      const sorted = members.filter(m => !m.user.bot).sort((a, b) => a.joinedTimestamp - b.joinedTimestamp).first(10);
      const list = sorted.map((m, i) => `**${i + 1}.** ${m.user.tag} — <t:${Math.floor(m.joinedTimestamp / 1000)}:R>`).join('\n');
      await interaction.editReply({ embeds: [info('📥 İlk Katılan 10 Üye', list)] });
    }

    // ── /davet ────────────────────────────────────────────────
    else if (commandName === 'davet') {
      await interaction.reply({ embeds: [info('🔗 Bot Daveti', `Botu sunucuna eklemek için [buraya tıkla](https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands)!`)] });
    }

    // ── /davetler ─────────────────────────────────────────────
    else if (commandName === 'davetler') {
      const targetUser = interaction.options.getUser('kullanici') || user;
      const invData = getInviteData(guild.id, targetUser.id);
      const real = getRealInvites(invData);
      const aktif = invData.invitedUsers.filter(u => !u.leftAt).length;

      await interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`📨 ${targetUser.username} — Davet İstatistikleri`)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '⭐ Gerçek Davet', value: `**${real}**`, inline: true },
          { name: '📊 Toplam', value: `**${invData.total}**`, inline: true },
          { name: '✅ Hâlâ Sunucuda', value: `**${aktif}**`, inline: true },
          { name: '📤 Ayrılanlar', value: `**${invData.left}**`, inline: true },
          { name: '⚠️ Fake', value: `**${invData.fake}**`, inline: true },
          { name: '🎁 Bonus', value: `**${invData.bonus}**`, inline: true },
        )
        .setFooter({ text: 'Gerçek = Toplam - Ayrılan - Fake + Bonus' })
        .setTimestamp()
      ] });
    }

    // ── /davet-liste ──────────────────────────────────────────
    else if (commandName === 'davet-liste') {
      const targetUser = interaction.options.getUser('kullanici') || user;
      const filtre = interaction.options.getString('filtre') || 'hepsi';
      const invData = getInviteData(guild.id, targetUser.id);

      let liste = invData.invitedUsers;
      if (filtre === 'aktif') liste = liste.filter(u => !u.leftAt);
      if (filtre === 'ayrilanlar') liste = liste.filter(u => u.leftAt);

      if (!liste.length) {
        return interaction.reply({ embeds: [info('📋 Davet Listesi', `${targetUser.username} bu filtrede kimse yok.`)] });
      }

      const PAGE = 15;
      const shown = liste.slice(0, PAGE);
      const lines = shown.map((u, i) => {
        const status = u.leftAt ? `📤 Ayrıldı (<t:${Math.floor(u.leftAt/1000)}:R>)` : '✅ Sunucuda';
        return `**${i+1}.** <@${u.id}> — ${status}\n└ Katılım: <t:${Math.floor(u.joinedAt/1000)}:d>`;
      }).join('\n');

      await interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`📋 ${targetUser.username} — Davet Listesi`)
        .setDescription(lines)
        .addFields({ name: '📊 Özet', value: `${liste.length} kişi gösteriliyor ${liste.length > PAGE ? `(${PAGE}/${liste.length})` : ''}`, inline: false })
        .setTimestamp()
      ] });
    }

    // ── /davet-liderboard ─────────────────────────────────────
    else if (commandName === 'davet-liderboard') {
      const entries = [...db.inviteData.entries()]
        .filter(([k]) => k.startsWith(guild.id + '-'))
        .map(([k, v]) => ({ userId: k.split('-')[1], real: getRealInvites(v), total: v.total, left: v.left }))
        .filter(e => e.total > 0)
        .sort((a, b) => b.real - a.real)
        .slice(0, 10);

      if (!entries.length) return interaction.reply({ embeds: [info('🏆 Davet Sıralaması', 'Henüz davet verisi yok.')] });

      const medals = ['🥇', '🥈', '🥉'];
      const lines = entries.map((e, i) =>
        `${medals[i] || `**${i+1}.**`} <@${e.userId}> — **${e.real}** gerçek *(${e.total} toplam, ${e.left} ayrıldı)*`
      ).join('\n');

      await interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('🏆 Davet Sıralaması')
        .setDescription(lines)
        .setTimestamp()
      ] });
    }

    // ── /davet-sifirla ────────────────────────────────────────
    else if (commandName === 'davet-sifirla') {
      const targetUser = interaction.options.getUser('kullanici');
      const key = `${guild.id}-${targetUser.id}`;
      db.inviteData.set(key, { total: 0, left: 0, fake: 0, bonus: 0, invitedUsers: [] });
      db.invites.set(key, 0);
      await interaction.reply({ embeds: [ok('Sıfırlandı', `${targetUser.tag} kullanıcısının davet verileri sıfırlandı.`)] });
    }

    // ── /davet-bonus ──────────────────────────────────────────
    else if (commandName === 'davet-bonus') {
      const targetUser = interaction.options.getUser('kullanici');
      const miktar = interaction.options.getInteger('miktar');
      const key = `${guild.id}-${targetUser.id}`;
      db.invites.set(key, (db.invites.get(key) || 0) + miktar);
      await interaction.reply({ embeds: [ok('Bonus Davet', `${targetUser.tag} kullanıcısına **+${miktar}** bonus davet eklendi. Toplam: **${db.invites.get(key)}**`)] });
    }

    // ── /davetlog ─────────────────────────────────────────────
    else if (commandName === 'davetlog') {
      const kanal = interaction.options.getChannel('kanal');
      settings.davetLogChannel = kanal.id;
      await interaction.reply({ embeds: [ok('Davet Log', `Davet log kanalı ${kanal} olarak ayarlandı.`)] });
    }

    // ── /davet-rol ────────────────────────────────────────────
    else if (commandName === 'davet-rol') {
      const adet = interaction.options.getInteger('adet');
      const rol = interaction.options.getRole('rol');
      if (!settings.davetRoller) settings.davetRoller = [];
      settings.davetRoller.push({ adet, rolId: rol.id });
      await interaction.reply({ embeds: [ok('Davet Rol Ödülü', `**${adet}** davet yapınca ${rol} rolü verilecek.`)] });
    }

    // ── /oyun ─────────────────────────────────────────────────
    else if (commandName === 'oyun') {
      const oyun = interaction.options.getString('oyun');
      if (oyun === 'sayi') {
        await interaction.reply({ embeds: [info('🎮 Sayı Sayma Oyunu', 'Bu kanalda sayı sayma oyunu başlatıldı! Sırayla 1\'den itibaren sayın. Hata yapan kayeder!')] });
      } else if (oyun === 'kelime') {
        await interaction.reply({ embeds: [info('🎮 Kelime Türetme', 'Bir önceki kelimenin son harfiyle yeni kelime yazın!')] });
      } else {
        await interaction.reply({ embeds: [info('💣 Bomba Oyunu', 'Kelimeye harf ekleyerek bombayı ileriye atın. Kelimeyi tamamlamak zorunda kalan kaybeder!')] });
      }
    }

    // ── /ozelkomut-ekle ───────────────────────────────────────
    else if (commandName === 'ozelkomut-ekle') {
      const komut = interaction.options.getString('komut').toLowerCase();
      const yanit = interaction.options.getString('yanit');
      if (!settings.ozelKomutlar) settings.ozelKomutlar = {};
      settings.ozelKomutlar[komut] = yanit;
      await interaction.reply({ embeds: [ok('Özel Komut Eklendi', `\`!${komut}\` komutu oluşturuldu.`)] });
    }

    // ── /tag ──────────────────────────────────────────────────
    else if (commandName === 'tag') {
      const ad = interaction.options.getString('ad');
      const icerik = interaction.options.getString('icerik');
      if (!settings.tags) settings.tags = {};
      settings.tags[ad] = icerik;
      await interaction.reply({ embeds: [ok('Tag Oluşturuldu', `\`!${ad}\` tag'i kaydedildi.`)] });
    }

    // ── /emoji ────────────────────────────────────────────────
    else if (commandName === 'emoji') {
      const islem = interaction.options.getString('islem');
      if (islem === 'liste') {
        const emojis = guild.emojis.cache.map(e => e.toString()).join(' ');
        await interaction.reply({ embeds: [info(`😀 Emojiler (${guild.emojis.cache.size})`, emojis.slice(0, 4000) || 'Emoji yok.')], ephemeral: true });
      } else {
        await interaction.reply({ embeds: [info('Emoji Yönetimi', `Emoji ${islem} için lütfen emoji ID\'sini ve görseli sağlayın. (Discord API üzerinden yapılır)`)] });
      }
    }

    // ── /ye ───────────────────────────────────────────────────
    else if (commandName === 'ye') {
      await interaction.reply({ embeds: [info('🤖 Bot Hakkında', `Merhaba! Ben **${client.user.username}**.\nModerasyondan eğlenceye her şey için burdayım!\n\n\`/06yardim\` ile tüm komutları görebilirsin.`)] });
    }

    // ── /hedef ────────────────────────────────────────────────
    else if (commandName === 'hedef') {
      const total = guild.memberCount;
      const hedefler = [100, 250, 500, 1000, 2500, 5000].find(h => h > total) || total + 1000;
      const oran = Math.min(100, Math.floor((total / hedefler) * 100));
      const bar = '█'.repeat(Math.floor(oran / 5)) + '░'.repeat(20 - Math.floor(oran / 5));
      await interaction.reply({
        embeds: [embed(Colors.teal, '🎯 Üye Hedef Sistemi', null, [
          { name: '👥 Mevcut Üye', value: `${total}`, inline: true },
          { name: '🎯 Hedef', value: `${hedefler}`, inline: true },
          { name: '📊 İlerleme', value: `\`${bar}\` %${oran}`, inline: false },
        ])]
      });
    }

    // ── /bildirim ─────────────────────────────────────────────
    else if (commandName === 'bildirim') {
      const platform = interaction.options.getString('platform');
      const kanalAdi = interaction.options.getString('kanal_adi');
      const discordKanal = interaction.options.getChannel('discord_kanal');
      const platformEmoji = { youtube: '🔴 YouTube', twitch: '🟣 Twitch', instagram: '🟠 Instagram' }[platform];
      await interaction.reply({ embeds: [ok('Bildirim Ayarlandı', `**${platformEmoji}** için \`${kanalAdi}\` kanalının yayın bildirimleri ${discordKanal} kanalına gönderilecek.\n\n*(Gerçek bildirimler için ilgili platform API entegrasyonu gereklidir)*`)] });
    }

    // ── /ozeloda ──────────────────────────────────────────────
    else if (commandName === 'ozeloda') {
      const kanal = interaction.options.getChannel('kanal');
      settings.ozelOdaKanal = kanal.id;
      await interaction.reply({ embeds: [ok('Özel Oda Ayarlandı', `${kanal} kanalına katılan üyeler için otomatik özel oda oluşturulacak.`)] });
    }

    // ── /ticket-kur ───────────────────────────────────────────
    else if (commandName === 'ticket-kur') {
      const kanal = interaction.options.getChannel('kanal');
      const kategori = interaction.options.getChannel('ticket-kategori');
      const destekRol = interaction.options.getRole('destek-rol');

      settings.ticketSettings = {
        kanalId: kanal.id,
        kategoriId: kategori.id,
        destekRolId: destekRol.id,
      };

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_ac').setLabel('🎫 Ticket Aç').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket_bilgi').setLabel('ℹ️ Bilgi').setStyle(ButtonStyle.Primary),
      );

      await kanal.send({
        embeds: [embed(0x5865F2, '🎫 Destek Sistemi', [
          'Yardım almak için aşağıdaki butona tıklayarak ticket açabilirsiniz.',
          '',
          '📌 Ticket açmadan önce sorununuzu hazır edin',
          '🚫 Gereksiz ticket açmayın',
          '⏰ Ekibimiz en kısa sürede size dönecek',
        ].join('\n'), [
          { name: 'Destek Sistemi • Ticket Aç', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: false },
        ])],
        components: [row],
      });

      await interaction.reply({ embeds: [ok('Ticket Sistemi Kuruldu!', `Ticket paneli ${kanal} kanalına gönderildi.\n**Kategori:** ${kategori}\n**Destek Rolü:** ${destekRol}`)] });
    }

    // ── /ticket-kapat ─────────────────────────────────────────
    else if (commandName === 'ticket-kapat') {
      const ticketData = db.tickets.get(interaction.channelId);
      if (!ticketData) return interaction.reply({ embeds: [err('Bu kanal bir ticket kanalı değil.')], ephemeral: true });

      await interaction.reply({ embeds: [embed(0xe74c3c, '🔒 Ticket Kapatılıyor...', 'Bu kanal **5 saniye** içinde silinecek.')] });
      db.tickets.delete(interaction.channelId);
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }

    // ── /spawner-market-kur ───────────────────────────────────
    else if (commandName === 'spawner-market-kur') {
      const kanal = interaction.options.getChannel('kanal');
      const sp = db.spawnerSettings.get(guild.id) || { alis: 4200000, satis: 5000000, minimum: 8 };
      db.spawnerSettings.set(guild.id, sp);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('spawner_sat').setLabel('💚 Bize Satmak İstiyorsan').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('spawner_al').setLabel('❤️ Bizden Almak İstiyorsan').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('spawner_bilgi').setLabel('ℹ️ Bilgi').setStyle(ButtonStyle.Secondary),
      );

      await kanal.send({
        embeds: [embed(0xff6600, '💀🔥 SPAWNER MARKET 💀🔥', 'Aşağıdan işlem yapmak istediğin kategoriyi seç!', [
          { name: '🟢 BİZE SATMAK İSTİYORSAN (Sen satarsın)', value: `Alış fiyatı: **${sp.alis.toLocaleString('tr-TR')}** / stack`, inline: false },
          { name: '🔴 BİZDEN ALMAK İSTİYORSAN (Sen alırsın)', value: `Satış fiyatı: **${sp.satis.toLocaleString('tr-TR')}** / stack`, inline: false },
          { name: '✅ Minimum', value: `${sp.minimum} spawner minimum`, inline: true },
          { name: 'ℹ️ Bilgi', value: 'Fiyatlar değişebilir', inline: true },
        ])],
        components: [row],
      });

      await interaction.reply({ embeds: [ok('Spawner Market Kuruldu!', `Market paneli ${kanal} kanalına gönderildi.`)] });
    }

    // ── /spawner-fiyat ────────────────────────────────────────
    else if (commandName === 'spawner-fiyat') {
      const alis = interaction.options.getInteger('alis');
      const satis = interaction.options.getInteger('satis');
      const minimum = interaction.options.getInteger('minimum') || (db.spawnerSettings.get(guild.id)?.minimum ?? 8);

      db.spawnerSettings.set(guild.id, { alis, satis, minimum });
      await interaction.reply({ embeds: [ok('Spawner Fiyatları Güncellendi', `**Alış:** ${alis.toLocaleString('tr-TR')} / stack\n**Satış:** ${satis.toLocaleString('tr-TR')} / stack\n**Minimum:** ${minimum} stack`)] });
    }

    // ── /para ─────────────────────────────────────────────────
    else if (commandName === 'para') {
      const targetUser = interaction.options.getUser('kullanici') || user;
      const eco = getEconomy(guild.id, targetUser.id);
      await interaction.reply({ embeds: [embed(Colors.gold, '💰 Para Durumu', null, [
        { name: '👤 Kullanıcı', value: `${targetUser}`, inline: true },
        { name: '💵 Bakiye', value: `**${eco.balance.toLocaleString('tr-TR')}** 💰`, inline: true },
      ])] });
    }

    // ── /gunluk ───────────────────────────────────────────────
    else if (commandName === 'gunluk') {
      const eco = getEconomy(guild.id, user.id);
      const now = Date.now();
      const cooldown = 24 * 60 * 60 * 1000;
      if (now - eco.lastDaily < cooldown) {
        const kalan = Math.ceil((eco.lastDaily + cooldown - now) / 3600000);
        return interaction.reply({ embeds: [err(`Günlük ödülünü aldın! **${kalan} saat** sonra tekrar gel.`)], ephemeral: true });
      }
      const miktar = Math.floor(Math.random() * 500) + 500;
      eco.balance += miktar;
      eco.lastDaily = now;
      await interaction.reply({ embeds: [ok('💰 Günlük Ödül!', `**+${miktar}** 💰 kazandın! Toplam: **${eco.balance.toLocaleString('tr-TR')}** 💰`)] });
    }

    // ── /calis ────────────────────────────────────────────────
    else if (commandName === 'calis') {
      const eco = getEconomy(guild.id, user.id);
      const now = Date.now();
      const cooldown = 2 * 60 * 60 * 1000;
      if (now - eco.lastWork < cooldown) {
        const kalan = Math.ceil((eco.lastWork + cooldown - now) / 60000);
        return interaction.reply({ embeds: [err(`Yorgunsun! **${kalan} dakika** sonra tekrar çalışabilirsin.`)], ephemeral: true });
      }
      const isler = ['Discord sunucusu yönetti', 'Kod yazdı', 'Pizza dağıttı', 'Minecraft oynadı', 'Sunucu moderasyonu yaptı', 'Meme yaptı'];
      const is = isler[Math.floor(Math.random() * isler.length)];
      const miktar = Math.floor(Math.random() * 200) + 100;
      eco.balance += miktar;
      eco.lastWork = now;
      await interaction.reply({ embeds: [ok('💼 Çalışma Ödülü', `${is} ve **+${miktar}** 💰 kazandın!
Toplam: **${eco.balance.toLocaleString('tr-TR')}** 💰`)] });
    }

    // ── /cal ──────────────────────────────────────────────────
    else if (commandName === 'cal') {
      const target = interaction.options.getUser('kullanici');
      if (target.id === user.id) return interaction.reply({ embeds: [err('Kendinden çalamazsın!')], ephemeral: true });
      if (target.bot) return interaction.reply({ embeds: [err('Botlardan para çalamazsın!')], ephemeral: true });
      const eco = getEconomy(guild.id, user.id);
      const targetEco = getEconomy(guild.id, target.id);
      const now = Date.now();
      const cooldown = 4 * 60 * 60 * 1000;
      if (now - eco.lastRob < cooldown) {
        const kalan = Math.ceil((eco.lastRob + cooldown - now) / 60000);
        return interaction.reply({ embeds: [err(`Son soygunun üstünden yeterli zaman geçmedi! **${kalan} dakika** bekle.`)], ephemeral: true });
      }
      if (targetEco.balance < 100) return interaction.reply({ embeds: [err('Bu kişinin çalacak parası yok!')], ephemeral: true });
      eco.lastRob = now;
      const basari = Math.random() < 0.45;
      if (basari) {
        const miktar = Math.floor(Math.random() * Math.min(targetEco.balance * 0.3, 500)) + 50;
        eco.balance += miktar;
        targetEco.balance -= miktar;
        await interaction.reply({ embeds: [ok('🦝 Soygun Başarılı!', `${target} kullanıcısından **${miktar}** 💰 çaldın!
Yeni bakiyen: **${eco.balance.toLocaleString('tr-TR')}** 💰`)] });
      } else {
        const ceza = Math.floor(Math.random() * 200) + 50;
        eco.balance = Math.max(0, eco.balance - ceza);
        await interaction.reply({ embeds: [err(`🚔 Yakalandın! **${ceza}** 💰 ceza ödedin.
Yeni bakiyen: **${eco.balance.toLocaleString('tr-TR')}** 💰`)] });
      }
    }

    // ── /transfer ─────────────────────────────────────────────
    else if (commandName === 'transfer') {
      const target = interaction.options.getUser('kullanici');
      const miktar = interaction.options.getInteger('miktar');
      if (target.id === user.id) return interaction.reply({ embeds: [err('Kendine para gönderemezsin!')], ephemeral: true });
      if (target.bot) return interaction.reply({ embeds: [err('Botlara para gönderemezsin!')], ephemeral: true });
      const eco = getEconomy(guild.id, user.id);
      if (eco.balance < miktar) return interaction.reply({ embeds: [err(`Yetersiz bakiye! Bakiyen: **${eco.balance.toLocaleString('tr-TR')}** 💰`)], ephemeral: true });
      const targetEco = getEconomy(guild.id, target.id);
      eco.balance -= miktar;
      targetEco.balance += miktar;
      await interaction.reply({ embeds: [ok('💸 Transfer Başarılı', `${target} kullanıcısına **${miktar.toLocaleString('tr-TR')}** 💰 gönderildi.`)] });
    }

    // ── /kumar ────────────────────────────────────────────────
    else if (commandName === 'kumar') {
      const miktar = interaction.options.getInteger('miktar');
      const eco = getEconomy(guild.id, user.id);
      if (eco.balance < miktar) return interaction.reply({ embeds: [err(`Yetersiz bakiye! Bakiyen: **${eco.balance.toLocaleString('tr-TR')}** 💰`)], ephemeral: true });
      const roll = Math.random();
      if (roll > 0.5) {
        eco.balance += miktar;
        await interaction.reply({ embeds: [ok('🎰 Kazandın!', `**+${miktar.toLocaleString('tr-TR')}** 💰 kazandın! Bakiyen: **${eco.balance.toLocaleString('tr-TR')}** 💰\n🎲 Şans: %${Math.floor(roll * 100)}`)] });
      } else {
        eco.balance -= miktar;
        await interaction.reply({ embeds: [err(`**-${miktar.toLocaleString('tr-TR')}** 💰 kaybettin. Bakiyen: **${eco.balance.toLocaleString('tr-TR')}** 💰\n🎲 Şans: %${Math.floor(roll * 100)}`)] });
      }
    }

    // ── /zenginler ────────────────────────────────────────────
    else if (commandName === 'zenginler') {
      const entries = [...db.economy.entries()]
        .filter(([k]) => k.startsWith(guild.id + '-'))
        .map(([k, v]) => ({ userId: k.split('-')[1], balance: v.balance }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 10);
      if (!entries.length) return interaction.reply({ embeds: [info('💰 Zenginler', 'Henüz kimse para kazanmamış.')] });
      const list = entries.map((e, i) => `${['🥇','🥈','🥉'][i] || `**${i+1}.**`} <@${e.userId}> — **${e.balance.toLocaleString('tr-TR')}** 💰`).join('\n');
      await interaction.reply({ embeds: [embed(Colors.gold, '💰 En Zenginler', list)] });
    }

    // ── /para-ver ─────────────────────────────────────────────
    else if (commandName === 'para-ver') {
      const target = interaction.options.getUser('kullanici');
      const miktar = interaction.options.getInteger('miktar');
      const targetEco = getEconomy(guild.id, target.id);
      targetEco.balance += miktar;
      await interaction.reply({ embeds: [ok('Para Verildi', `${target} kullanıcısına **${miktar.toLocaleString('tr-TR')}** 💰 verildi.`)] });
    }

    // ── /para-al ──────────────────────────────────────────────
    else if (commandName === 'para-al') {
      const target = interaction.options.getUser('kullanici');
      const miktar = interaction.options.getInteger('miktar');
      const targetEco = getEconomy(guild.id, target.id);
      targetEco.balance = Math.max(0, targetEco.balance - miktar);
      await interaction.reply({ embeds: [ok('Para Alındı', `${target} kullanıcısından **${miktar.toLocaleString('tr-TR')}** 💰 alındı.`)] });
    }

    // ── /cekilisbaslat ────────────────────────────────────────
    else if (commandName === 'cekilisbaslat') {
      const odul = interaction.options.getString('odul');
      const sure = interaction.options.getInteger('sure');
      const kazanan = interaction.options.getInteger('kazanan') || 1;
      const kanal = interaction.options.getChannel('kanal') || interaction.channel;
      const endTime = Date.now() + sure * 60 * 1000;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('PLACEHOLDER').setLabel('🎉 Katıl (0)').setStyle(ButtonStyle.Success)
      );

      const msg = await kanal.send({
        embeds: [embed(0x2ecc71, '🎉 ÇEKİLİŞ!', `**Ödül:** ${odul}`, [
          { name: '⏰ Bitiş', value: `<t:${Math.floor(endTime / 1000)}:R>`, inline: true },
          { name: '🏆 Kazanan', value: `${kazanan} kişi`, inline: true },
          { name: '🎟️ Başlatan', value: `${user}`, inline: true },
        ])],
        components: [row],
      });

      // Gerçek buton ID'sini güncelle
      const realRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`giveaway_join_${msg.id}`).setLabel('🎉 Katıl (0)').setStyle(ButtonStyle.Success)
      );
      await msg.edit({ components: [realRow] });

      db.giveaways.set(msg.id, { prize: odul, winners: kazanan, endTime, channelId: kanal.id, guildId: guild.id, entries: [], ended: false });
      await interaction.reply({ embeds: [ok('Çekiliş Başlatıldı!', `${kanal} kanalında çekiliş başladı!`)], ephemeral: true });
    }

    // ── /cekilisbitir ─────────────────────────────────────────
    else if (commandName === 'cekilisbitir') {
      const msgId = interaction.options.getString('mesaj_id');
      const giveaway = db.giveaways.get(msgId);
      if (!giveaway) return interaction.reply({ embeds: [err('Çekiliş bulunamadı.')], ephemeral: true });
      await endGiveaway(giveaway, msgId, client);
      await interaction.reply({ embeds: [ok('Çekiliş Bitirildi', 'Çekiliş manuel olarak sonlandırıldı.')], ephemeral: true });
    }

    // ── /cekilistekrar ────────────────────────────────────────
    else if (commandName === 'cekilistekrar') {
      const msgId = interaction.options.getString('mesaj_id');
      const giveaway = db.giveaways.get(msgId);
      if (!giveaway || !giveaway.ended) return interaction.reply({ embeds: [err('Sona ermiş bir çekiliş bulunamadı.')], ephemeral: true });
      giveaway.ended = false;
      giveaway.endTime = Date.now() + 10000;
      await endGiveaway(giveaway, msgId, client);
      await interaction.reply({ embeds: [ok('Çekiliş Tekrarlandı', 'Yeni kazananlar belirlendi!')], ephemeral: true });
    }

    // ── /dogrulama-kur ────────────────────────────────────────
    else if (commandName === 'dogrulama-kur') {
      const kanal = interaction.options.getChannel('kanal');
      const rol = interaction.options.getRole('rol');
      settings.dogrulamaSettings = { kanalId: kanal.id, rolId: rol.id };

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('dogrulama_onayla').setLabel('✅ Doğrulamak İçin Tıkla').setStyle(ButtonStyle.Success)
      );

      await kanal.send({
        embeds: [embed(0x2ecc71, '✅ Doğrulama Sistemi', [
          'Sunucuya hoş geldin! 👋',
          '',
          'Sunucuya tam erişim sağlamak için aşağıdaki butona tıkla.',
          '> ✅ Kuralları okuduğunu ve kabul ettiğini beyan ediyorsun.',
        ].join('\n'))],
        components: [row],
      });

      await interaction.reply({ embeds: [ok('Doğrulama Kuruldu!', `${kanal} kanalına doğrulama paneli gönderildi.\n**Rol:** ${rol}`)] });
    }

    // ── /starboard-kur ────────────────────────────────────────
    else if (commandName === 'starboard-kur') {
      const kanal = interaction.options.getChannel('kanal');
      const esik = interaction.options.getInteger('esik') || 3;
      settings.starboard = { kanalId: kanal.id, esik };
      await interaction.reply({ embeds: [ok('⭐ Starboard Kuruldu', `Starboard kanalı: ${kanal}\nEşik: **${esik} ⭐**`)] });
    }

    // ── /anket ────────────────────────────────────────────────
    else if (commandName === 'anket') {
      const soru = interaction.options.getString('soru');
      const options = [
        interaction.options.getString('secenek1'),
        interaction.options.getString('secenek2'),
        interaction.options.getString('secenek3'),
        interaction.options.getString('secenek4'),
      ].filter(Boolean);

      const emojis = ['🅰️', '🅱️', '🇨', '🇩'];
      const fields = options.map((opt, i) => ({ name: `${emojis[i]} ${opt}`, value: '`░░░░░░░░░░` **0** oy (0%)', inline: false }));

      const row = new ActionRowBuilder().addComponents(
        options.map((opt, i) => new ButtonBuilder().setCustomId('POLLID').setLabel(`${['A','B','C','D'][i]}: ${opt.slice(0,30)}`).setStyle(ButtonStyle.Primary))
      );

      const msg = await interaction.channel.send({
        embeds: [embed(0x3498db, `📊 ${soru}`, `**Toplam:** 0 oy`, fields)],
        components: [row],
      });

      // Gerçek buton IDleri
      const realRow = new ActionRowBuilder().addComponents(
        options.map((opt, i) => new ButtonBuilder().setCustomId(`poll_${msg.id}_${i}`).setLabel(`${['A','B','C','D'][i]}: ${opt.slice(0,30)}`).setStyle(ButtonStyle.Primary))
      );
      await msg.edit({ components: [realRow] });

      db.polls.set(msg.id, { question: soru, options, votes: new Map(), channelId: interaction.channelId });
      await interaction.reply({ embeds: [ok('📊 Anket Oluşturuldu!', `Anket bu kanala gönderildi.`)], ephemeral: true });
    }

    // ── /rol-secici ───────────────────────────────────────────
    else if (commandName === 'rol-secici') {
      const baslik = interaction.options.getString('baslik');
      const rolIdsStr = interaction.options.getString('roller');
      const rolIds = rolIdsStr.split(',').map(r => r.trim());
      const roller = rolIds.map(id => guild.roles.cache.get(id)).filter(Boolean);
      if (!roller.length) return interaction.reply({ embeds: [err('Geçerli rol bulunamadı.')], ephemeral: true });

      const buttons = roller.map(r => new ButtonBuilder().setCustomId(`rolsec_${r.id}`).setLabel(r.name).setStyle(ButtonStyle.Secondary));
      const rows = [];
      for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));

      await interaction.channel.send({
        embeds: [embed(0x9b59b6, `🎭 ${baslik}`, roller.map(r => `• ${r}`).join('\n') + '\n\n*Almak/bırakmak için butona tıkla!*')],
        components: rows,
      });
      await interaction.reply({ embeds: [ok('Rol Seçici Kuruldu!', 'Panel gönderildi.')], ephemeral: true });
    }

    // ── /antispam ─────────────────────────────────────────────
    else if (commandName === 'antispam') {
      const aktif = interaction.options.getBoolean('aktif');
      const limit = interaction.options.getInteger('limit') || 5;
      settings.antispam = { aktif, limit };
      await interaction.reply({ embeds: [ok('Anti-Spam', `Anti-spam sistemi **${aktif ? 'aktif' : 'devre dışı'}** edildi.\n**Limit:** ${limit} mesaj / 5 saniye`)] });
    }

    // ── /8top ─────────────────────────────────────────────────
    else if (commandName === '8top') {
      const soru = interaction.options.getString('soru');
      const cevaplar = ["Kesinlikle evet! 🎱", "Evet, bundan eminim. 🎱", "Gözüme çok iyi görünüyor! 🎱", "Belirtiler evet diyor. 🎱", "Bence evet. 🎱", "Şüphem yok. 🎱", "Cevap evet. 🎱", "Daha sonra sor. 🎱", "Şimdi tahmin edemiyorum. 🎱", "Konsantre olamadım, tekrar sor. 🎱", "Yanıtım hayır. 🎱", "Hiç zannetmiyorum. 🎱", "Pek ümit verici görünmüyor. 🎱", "Bence hayır. 🎱", "Görünüşe göre hayır. 🎱"];
      const cevap = cevaplar[Math.floor(Math.random() * cevaplar.length)];
      await interaction.reply({ embeds: [embed(0x2c3e50, '🎱 Sihirli 8-Top', `**Soru:** ${soru}\n\n**Cevap:** ${cevap}`)] });
    }

    // ── /yada ─────────────────────────────────────────────────
    else if (commandName === 'yada') {
      const sorular = ["Uçabilmek mi, görünmez olmak mı?", "Sürekli şarkı söylemek zorunda kalmak mı, sürekli dans etmek zorunda kalmak mı?", "Her şeyi bilen biri mi olmak, yoksa her şeyi yapabilen biri mi?", "Hiç yalan söylememek zorunda mak mı, yoksa her şeyi bilmek mi?", "Denizaltında yaşamak mı, uzayda yaşamak mı?"];
      const soru = sorular[Math.floor(Math.random() * sorular.length)];
      await interaction.reply({ embeds: [embed(Colors.purple, '🤔 Hangisini Tercih Edersin?', soru)] });
    }

    // ── /trivia ───────────────────────────────────────────────
    else if (commandName === 'trivia') {
      const sorular = [{"s": "Türkiye'nin başkenti neresidir?", "c": "Ankara"}, {"s": "Güneş sisteminde kaç gezegen vardır?", "c": "8"}, {"s": "Python programlama dili hangi yılda çıktı?", "c": "1991"}, {"s": "Discord hangi yılda kuruldu?", "c": "2015"}, {"s": "Dünyanın en büyük okyanusu hangisidir?", "c": "Büyük Okyanus"}, {"s": "Bir yılda kaç hafta vardır?", "c": "52"}, {"s": "Pi sayısının ilk 3 basamağı nedir?", "c": "3.14"}, {"s": "Minecraft hangi yıl çıktı?", "c": "2011"}];
      const q = sorular[Math.floor(Math.random() * sorular.length)];
      await interaction.reply({
        embeds: [embed(Colors.teal, '🧠 Trivia Sorusu', q.s, [
          { name: '⏰ Süre', value: '30 saniye düşün!', inline: true },
        ])]
      });
      const filter = m => m.channelId === interaction.channelId && !m.author.bot;
      const collector = interaction.channel.createMessageCollector({ filter, time: 30000 });
      collector.on('collect', async m => {
        if (m.content.toLowerCase().includes(q.c.toLowerCase())) {
          collector.stop('correct');
          await m.reply({ embeds: [ok('🎉 Doğru!', `Tebrikler ${m.author}! Cevap: **${q.c}**`)] });
        }
      });
      collector.on('end', async (_, reason) => {
        if (reason !== 'correct') await interaction.followUp({ embeds: [err(`Süre doldu! Doğru cevap: **${q.c}**`)] });
      });
    }

    // ── /sarap ────────────────────────────────────────────────
    else if (commandName === 'sarap') {
      const target = interaction.options.getUser('kullanici');
      const sarActions = ['sımsıkı sardı', 'burito gibi sardı', 'taco gibi sardı', 'battaniyeye sardı'];
      const action = sarActions[Math.floor(Math.random() * sarActions.length)];
      await interaction.reply({ embeds: [embed(Colors.teal, '🌯 Sarma!', `${user} ${target} kullanıcısını ${action}! 🌯`)] });
    }

    // ── /tokat ────────────────────────────────────────────────
    else if (commandName === 'tokat') {
      const target = interaction.options.getUser('kullanici');
      const tokatlar = ['hafif bir tokat attı', 'güçlü bir tokat attı', 'balık gibi tokat attı', 'eldiven gibi tokat attı'];
      const action = tokatlar[Math.floor(Math.random() * tokatlar.length)];
      await interaction.reply({ embeds: [embed(Colors.error, '👋 Tokat!', `${user} → ${target} kullanıcısına ${action}! 😳`)] });
    }

    // ── /dans ─────────────────────────────────────────────────
    else if (commandName === 'dans') {
      const danslar = ['💃 Samba yapıyor!', '🕺 Breakdance yapıyor!', '🩰 Bale yapıyor!', '🎷 Jazz dansı yapıyor!', '🤖 Robot dansı yapıyor!'];
      const dans = danslar[Math.floor(Math.random() * danslar.length)];
      await interaction.reply({ embeds: [embed(Colors.purple, '💃 Dans Zamanı!', `${user} ${dans}`)] });
    }

    // ── /yuksek-alcak ─────────────────────────────────────────
    else if (commandName === 'yuksek-alcak') {
      const sayi = Math.floor(Math.random() * 100) + 1;
      await interaction.reply({
        embeds: [embed(Colors.teal, '🔢 Yüksek mı Alçak mı?', `Bir sayı düşündüm! (1-100)\n**50**'den yüksek mi, alçak mı?`)]
      });
      const filter = m => m.channelId === interaction.channelId && !m.author.bot;
      const coll = interaction.channel.createMessageCollector({ filter, time: 15000, max: 1 });
      coll.on('collect', async m => {
        const guess = m.content.toLowerCase();
        const correct = (sayi > 50 && (guess === 'yüksek' || guess === 'yuksek')) || (sayi <= 50 && (guess === 'alçak' || guess === 'alcak'));
        if (correct) {
          await m.reply({ embeds: [ok('🎉 Doğru!', `Sayım **${sayi}** idi!`)] });
        } else {
          await m.reply({ embeds: [err(`Yanlış! Sayım **${sayi}** idi. (${sayi > 50 ? 'Yüksek' : 'Alçak'})`)] });
        }
      });
      coll.on('end', (coll, reason) => {
        if (reason === 'time') interaction.followUp({ embeds: [warn('Süre Doldu', `Cevap vermedin. Sayım **${sayi}** idi.`)] }).catch(() => {});
      });
    }

    // ── /zar ──────────────────────────────────────────────────
    else if (commandName === 'zar') {
      const yuz = interaction.options.getInteger('yuz') || 6;
      const sonuc = Math.floor(Math.random() * yuz) + 1;
      await interaction.reply({ embeds: [embed(Colors.teal, '🎲 Zar Atıldı!', `**${yuz}** yüzlü zar: **${sonuc}**`)] });
    }

    // ── /yaztura ──────────────────────────────────────────────
    else if (commandName === 'yaztura') {
      const sonuc = Math.random() < 0.5 ? '🪙 Yazı!' : '🪙 Tura!';
      await interaction.reply({ embeds: [embed(Colors.gold, '🪙 Yazı Tura', sonuc)] });
    }

    // ── /rastgeleüye ──────────────────────────────────────────
    else if (commandName === 'rastgeleüye') {
      const uyeler = guild.members.cache.filter(m => !m.user.bot).map(m => m.user);
      const secilen = uyeler[Math.floor(Math.random() * uyeler.length)];
      await interaction.reply({ embeds: [embed(Colors.purple, '🎰 Rastgele Üye', `Seçilen üye: ${secilen}`)] });
    }

    // ── /kelimeuzunluk ────────────────────────────────────────
    else if (commandName === 'kelimeuzunluk') {
      await interaction.reply({ embeds: [embed(Colors.teal, '📝 Kelime Yarışması!', '30 saniye içinde en uzun kelimeyi kim yazarsa kazanır! Başlıyorum... 3... 2... 1... YAZIN!')] });
      const filter = m => m.channelId === interaction.channelId && !m.author.bot && m.content.split(' ').length === 1;
      const coll = interaction.channel.createMessageCollector({ filter, time: 30000 });
      let enUzun = { user: null, kelime: '' };
      coll.on('collect', m => {
        if (m.content.length > enUzun.kelime.length) enUzun = { user: m.author, kelime: m.content };
      });
      coll.on('end', async () => {
        if (enUzun.user) {
          await interaction.followUp({ embeds: [ok('🏆 Kelime Yarışması Bitti!', `Kazanan: ${enUzun.user}\nKelime: **${enUzun.kelime}** (${enUzun.kelime.length} harf)`)] });
        } else {
          await interaction.followUp({ embeds: [err('Kimse kelime yazmadı!')] });
        }
      });
    }

    // ── /yardim ───────────────────────────────────────────────
    else if (commandName === '06yardim') {
      await interaction.reply({
        embeds: [embed(Colors.teal, '🛡️ Bot Komutları', 'Tüm komutlar aşağıda listelenmiştir:', [
          { name: '🔨 Moderasyon', value: '`/ban` `/kick` `/mute` `/unmute` `/warn` `/uyarilar` `/temizle` `/isim-duzeltme` `/yasakli-kelime` `/yasakli-komut` `/yavasmod`' },
          { name: '⚙️ Ayarlar', value: '`/log` `/loglar` `/galeri` `/oneri` `/oto-rol` `/prefix` `/tecrubemiktar` `/rankmuaf` `/seviyeatla-mesaj` `/rank-ayar` `/seviye-rol` `/gorevli`' },
          { name: '👤 Kullanıcı', value: '`/userinfo` `/avatar` `/sunucu` `/roller` `/id` `/shard` `/istatistik`' },
          { name: '⭐ Rank & XP', value: '`/rank` `/rankboost` `/top`' },
          { name: '🎮 Eğlence', value: '`/ship` `/qr` `/renk` `/tersçevir` `/pankart` `/surecevir` `/doviz` `/clyde` `/konustur` `/embed` `/oyun`' },
          { name: '👥 Sosyal', value: '`/rep` `/profil` `/dogumgunu` `/hatirlatici` `/katilim`' },
          { name: '📨 Davet & Tracker', value: '`/davetler` `/davet-liste` `/davet-liderboard` `/davet-bonus` `/davetlog` `/davet-rol` `/davet-sifirla`' },
          { name: '💰 Ekonomi', value: '`/para` `/gunluk` `/calis` `/cal` `/transfer` `/kumar` `/zenginler`' },
          { name: '🎉 Çekiliş', value: '`/cekilisbaslat` `/cekilisbitir` `/cekilistekrar`' },
          { name: '✅ Doğrulama', value: '`/dogrulama-kur`' },
          { name: '⭐ Starboard', value: '`/starboard-kur`' },
          { name: '📊 Anket', value: '`/anket`' },
          { name: '🎭 Rol Seçici', value: '`/rol-secici`' },
          { name: '🚫 Anti-Spam', value: '`/antispam`' },
          { name: '🎮 Eğlence+', value: '`/8top` `/yada` `/trivia` `/sarap` `/tokat` `/dans` `/yuksek-alcak` `/zar` `/yaztura` `/rastgeleüye` `/kelimeuzunluk`' },
          { name: '🎫 Ticket', value: '`/ticket-kur` `/ticket-kapat`' },
          { name: '💀 Spawner Market', value: '`/spawner-market-kur` `/spawner-fiyat`' },
          { name: '🔧 Diğer', value: '`/ye` `/hedef` `/bildirim` `/ozelkomut-ekle` `/tag` `/ozeloda` `/emoji`' },
        ])], ephemeral: true
      });
    }

  } catch (error) {
    console.error(`Komut hatası [${commandName}]:`, error);
    const errMsg = { embeds: [err('Bir hata oluştu. Lütfen tekrar deneyin.')], ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errMsg).catch(() => {});
    } else {
      await interaction.reply(errMsg).catch(() => {});
    }
  }
});

// ════════════════════════════════════════════════════════════════
// YARDIMCI: LOG GÖNDER
// ════════════════════════════════════════════════════════════════
async function sendLog(guild, settings, embedData) {
  if (!settings.logChannel) return;
  const logCh = guild.channels.cache.get(settings.logChannel);
  if (logCh) await logCh.send({ embeds: [embedData] }).catch(() => {});
}

// ════════════════════════════════════════════════════════════════
// BAĞLAN
// ════════════════════════════════════════════════════════════════
client.login(process.env.TOKEN);

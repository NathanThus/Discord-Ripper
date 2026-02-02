const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const path = require("path");
const https = require("https");

const TOKEN = "";
const CHANNEL_ID = "";
const OUTPUT_DIR = "./output";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ---------- Helpers ----------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    https.get(url, response => {
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", err => {
      fs.unlink(filePath, () => reject(err));
    });
  });
}

async function fetchAllMessages(channel) {
  let allMessages = [];
  let lastId = null;

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;

    allMessages.push(...messages.values());
    lastId = messages.last().id;
  }

  return allMessages.reverse(); // oldest → newest
}

// ---------- Main ----------

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  ensureDir(OUTPUT_DIR);
  ensureDir(path.join(OUTPUT_DIR, "attachments"));
  ensureDir(path.join(OUTPUT_DIR, "embeds"));

  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel || !channel.isTextBased()) {
    console.error("Invalid or non-text channel.");
    process.exit(1);
  }

  console.log("Fetching messages...");
  const messages = await fetchAllMessages(channel);

  let messageLog = [];
  let embedLog = [];

  for (const msg of messages) {
    const timestamp = msg.createdAt.toISOString();
    messageLog.push(`[${timestamp}] ${msg.author.tag}`);
    if (msg.content) messageLog.push(msg.content);

    // ---------- Attachments ----------
    for (const attachment of msg.attachments.values()) {
      const fileName = `${msg.id}-${attachment.name}`;
      const filePath = path.join(OUTPUT_DIR, "attachments", fileName);

      await downloadFile(attachment.url, filePath);
      messageLog.push(`Attachment saved: attachments/${fileName}`);
    }

    // ---------- Embeds ----------
    msg.embeds.forEach((embed, i) => {
      embedLog.push(`Message ${msg.id} — Embed ${i + 1}`);

      if (embed.title) embedLog.push(`Title: ${embed.title}`);
      if (embed.description) embedLog.push(`Description: ${embed.description}`);
      if (embed.url) embedLog.push(`URL: ${embed.url}`);

      // Downloadable embed assets
      const assets = [
        { obj: embed.image, label: "image" },
        { obj: embed.thumbnail, label: "thumbnail" }
      ];

      for (const asset of assets) {
        if (asset.obj?.url) {
          const ext = path.extname(asset.obj.url).split("?")[0] || ".png";
          const fileName = `${msg.id}-embed-${i + 1}-${asset.label}${ext}`;
          const filePath = path.join(OUTPUT_DIR, "embeds", fileName);

          downloadFile(asset.obj.url, filePath)
            .then(() => {
              embedLog.push(`Downloaded ${asset.label}: embeds/${fileName}`);
            })
            .catch(() => {
              embedLog.push(`Failed to download ${asset.label}: ${asset.obj.url}`);
            });
        }
      }

      embedLog.push(""); // spacing
    });

    messageLog.push(""); // spacing between messages
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, "messages.txt"), messageLog.join("\n"), "utf8");
  fs.writeFileSync(path.join(OUTPUT_DIR, "embeds.txt"), embedLog.join("\n"), "utf8");

  console.log(`Export complete: ${messages.length} messages`);
  process.exit(0);
});

client.login(TOKEN);

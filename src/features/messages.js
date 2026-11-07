// Sending plain messages and embeds as the bot, from the dashboard or /posalji.
import { EmbedBuilder } from 'discord.js';
import { COLOR } from '../utils/helpers.js';

const MAX_FIELDS = 25;
const MAX_TOTAL = 6000;

const str = (value, max) => String(value ?? '').trim().slice(0, max);

export function parseColor(value, fallback = COLOR) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!/^[0-9a-f]{6}$/i.test(hex)) throw new Error('Boja mora biti heksadecimalna, npr. #5865f2.');
  return Number.parseInt(hex, 16);
}

function url(value, label) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('protocol');
    return parsed.href;
  } catch {
    throw new Error(`${label} mora biti ispravan http(s) URL.`);
  }
}

export function normalizeFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields
    .map((field) => ({
      name: str(field?.name, 256),
      value: str(field?.value, 1024),
      inline: Boolean(field?.inline),
    }))
    .filter((field) => field.name && field.value)
    .slice(0, MAX_FIELDS);
}

export function buildMessagePayload(input = {}) {
  const content = str(input.content, 2000);
  const embedInput = input.embed && typeof input.embed === 'object' ? input.embed : null;
  const wantsEmbed = Boolean(embedInput?.enabled);
  const fields = wantsEmbed ? normalizeFields(embedInput.fields) : [];
  const title = wantsEmbed ? str(embedInput.title, 256) : '';
  const description = wantsEmbed ? str(embedInput.description, 4096) : '';
  const footer = wantsEmbed ? str(embedInput.footer, 2048) : '';
  const author = wantsEmbed ? str(embedInput.author, 256) : '';
  const image = wantsEmbed ? url(embedInput.imageUrl, 'Slika') : null;
  const thumbnail = wantsEmbed ? url(embedInput.thumbnailUrl, 'Miniatura') : null;
  const embedUrl = wantsEmbed ? url(embedInput.url, 'Poveznica') : null;
  const authorIcon = wantsEmbed ? url(embedInput.authorIconUrl, 'Ikona autora') : null;
  const footerIcon = wantsEmbed ? url(embedInput.footerIconUrl, 'Ikona podnožja') : null;

  if (!content && !wantsEmbed) throw new Error('Upiši tekst poruke ili uključi embed.');
  if (wantsEmbed && !title && !description && !fields.length && !image && !thumbnail) {
    throw new Error('Embed treba barem naslov, opis, polje ili sliku.');
  }
  const total = title.length + description.length + footer.length + author.length +
    fields.reduce((sum, f) => sum + f.name.length + f.value.length, 0);
  if (wantsEmbed && total > MAX_TOTAL) throw new Error(`Embed je predugačak (${total}/${MAX_TOTAL} znakova).`);

  const payload = { allowedMentions: { parse: [] } };
  if (content) payload.content = content;
  if (wantsEmbed) {
    const embed = new EmbedBuilder().setColor(parseColor(embedInput.color));
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    if (embedUrl) embed.setURL(embedUrl);
    if (author) embed.setAuthor({ name: author, iconURL: authorIcon ?? undefined });
    if (footer) embed.setFooter({ text: footer, iconURL: footerIcon ?? undefined });
    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (fields.length) embed.addFields(fields);
    if (embedInput.timestamp) embed.setTimestamp();
    payload.embeds = [embed];
  }
  return payload;
}

export async function sendMessage(channel, input) {
  const payload = buildMessagePayload(input);
  return channel.send(payload);
}

export const LIMITS = { MAX_FIELDS, MAX_TOTAL };

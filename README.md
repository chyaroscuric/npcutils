# 🤖 Jaankeza Utils

Custom Discord bot napravljen u [discord.js](https://discord.js.org) v14.

| Feature | Što radi |
| --- | --- |
| 🟢 **Uvijek aktivan** | Status `discord.gg/jaankeza`, auto-reconnect, ne pada na greškama, Docker / pm2 restart, keep-alive HTTP endpoint |
| 📊 **Stats kanali** | Kanali na vrhu servera: `👥 Članovi`, `🤖 Botovi`, `🚀 Boostovi` — ažuriraju se sami |
| 🎫 **Tiketi** | Panel s gumbom → privatni kanal → zatvaranje s transkriptom u log kanal |
| 📨 **Invite counter** | Prati tko je koga pozvao (pravi / izašli / lažni / bonus), leaderboard |
| 🏷️ **Autorole** | Svaki novi član automatski dobije npr. `Member` rolu |
| 👋 **Welcome poruka** | Poruka kad netko uđe (s avatarom, brojem člana i tko ga je pozvao) |
| 🚀 **Boost poruka** | Poruka zahvale kad netko boosta server |
| 😀 **Reaction roles** | Klikni emoji → dobiješ rolu, makni reakciju → izgubiš rolu |
| 🎉 **Giveaway** | Giveaway s gumbom za prijavu, automatsko izvlačenje, reroll |

---

## 1. Napravi bota na Discordu

1. Idi na <https://discord.com/developers/applications> → **New Application** → ime: **Jaankeza Utils**.
2. **Bot** tab:
   - **Reset Token** → kopiraj token (treba za `.env`).
   - Uključi **Privileged Gateway Intents**:
     - ✅ **Server Members Intent** (welcome, autorole, invite counter, stats)
     - ✅ **Message Content Intent** (transkripti tiketa)
3. Pozovi bota na server (zamijeni `CLIENT_ID` s **Application ID** iz *General Information*):

   ```
   https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot%20applications.commands
   ```

4. ⚠️ U **Server Settings → Roles** pomakni rolu **Jaankeza Utils** **iznad** svih rola koje bot treba davati (Member, reaction role…). Bot ne može dati rolu koja je iznad njegove.

## 2. Pokretanje

Treba [Node.js](https://nodejs.org) 20.12 ili noviji.

```bash
npm install
```

```bash
cp .env.example .env
```

U `.env` upiši `DISCORD_TOKEN=...` (i po želji `GUILD_ID=` ID svog servera — tada se slash komande pojave odmah).

```bash
npm start
```

Kad u konzoli piše `✅ Jaankeza Utils#xxxx je online`, bot radi. Sve postavke spremaju se u `data/db.json`.

## 3. Da bude uvijek aktivan (24/7)

Bot je online samo dok proces radi, pa ga treba pokrenuti na računalu/serveru koji je stalno upaljen (VPS, Raspberry Pi, hosting za botove…). Bot se sam ponovno spaja ako pukne veza, a greške ga ne ruše.

**Opcija A — Docker** (preporučeno; sam se restarta nakon pada ili restarta servera):

```bash
docker compose up -d --build
```

**Opcija B — pm2**:

```bash
npm install -g pm2
```

```bash
pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
```

**Opcija C — hosting koji traži otvoren port** (Render, Railway, Replit…): postavi `PORT` u env varijablama. Bot tada na tom portu vraća status (`{"online": true, ...}`), pa ga možeš pingati s UptimeRobotom.

> Na Dockeru/hostingu obavezno sačuvaj `data/` folder (volume), inače se izgube postavke i invite-ovi.

---

## 4. Podešavanje na serveru

Sve komande (osim `/help`, `/invites`, `/leaderboard`, `/ticket close|add|remove`) zahtijevaju **Manage Server** (reaction roles: **Manage Roles**).

### 📊 Stats kanali
- `/stats setup` — napravi kategoriju `📊 Statistika servera` s kanalima `👥 Članovi: N`, `🤖 Botovi: N`, `🚀 Boostovi: N` (zaključani, nitko ne može ući).
- `/stats refresh` — ručno osvježi, `/stats remove` — obriši.

> Discord dopušta preimenovanje kanala samo 2× u 10 minuta, pa se brojevi ažuriraju s malim zakašnjenjem (do ~5 min).

### 🎫 Tiketi
1. `/ticket setup kategorija:<kategorija> support_rola:@Staff log_kanal:#ticket-logs`
2. `/ticket panel` (opcionalno `kanal`, `naslov`, `opis`) — pošalje poruku s gumbom **Otvori tiket**.
3. Korisnik klikne → upiše razlog → dobije privatni kanal `ticket-0001`.
4. U tiketu: gumb **Zatvori tiket** ili `/ticket close`; staff može `/ticket add @osoba` i `/ticket remove @osoba`.
5. Kad se tiket zatvori, transkript (`.txt`) ide u log kanal.

### 📨 Invite counter
- `/invites [korisnik]` — koliko invite-ova netko ima (i tko je njega pozvao).
- `/leaderboard` — top 10.
- `/invitesadmin bonus korisnik broj` — dodaj/oduzmi bonus, `/invitesadmin reset [korisnik]`.

Ukupno = pravi − izašli + bonus. Računi mlađi od 7 dana broje se kao *lažni* i ne ulaze u ukupno.
Bot treba permisiju **Manage Server** da bi vidio invite-ove. Invite-ovi se broje od trenutka kad je bot dodan.

### 🏷️ Autorole (member rola)
- `/autorole add rola:@Member` — svaki novi član dobije rolu. Opcija `daj_postojecima:True` je da i svim trenutnim članovima.
- `/autorole remove`, `/autorole list`.

### 👋 Welcome poruka
- `/welcome set kanal:#dobrodošli [poruka]`, `/welcome test`, `/welcome off`
- Placeholderi: `{user}` (mention), `{username}`, `{server}`, `{memberCount}`, `{inviter}`, `{invites}`, `\n` = novi red.

Primjer: `/welcome set kanal:#welcome poruka:Hej {user}, dobrodošao/la na {server}!\nTi si {memberCount}. član.`

### 🚀 Boost poruka
- `/boost set kanal:#boosts [poruka]`, `/boost test`, `/boost off`
- Placeholderi: `{user}`, `{username}`, `{server}`, `{boosts}`, `{level}`.

### 😀 Reaction roles
1. `/reactionrole create naslov:Odaberi role [opis] [kanal]` — bot pošalje embed i vrati ID poruke.
2. `/reactionrole add poruka_id:<ID> emoji:🎮 rola:@Gamer` — ponovi za svaku rolu. Embed se sam ažurira s popisom.
3. `/reactionrole remove poruka_id:<ID> emoji:🎮`, `/reactionrole list`.

Može se koristiti i na bilo kojoj postojećoj poruci (desni klik → *Copy Message ID*, uz opciju `kanal` ako je poruka u drugom kanalu).

### 🎉 Giveaway
- `/giveaway start trajanje:1d pobjednika:1 nagrada:Discord Nitro [opis] [kanal]` — trajanje: `30m`, `2h`, `1d`, `1w`, `1d12h`…
- Članovi se prijave/odjave klikom na **🎉 Sudjeluj**.
- `/giveaway end poruka_id` — završi odmah, `/giveaway reroll poruka_id [pobjednika]` — novi pobjednici,
  `/giveaway list` — aktivni, `/giveaway delete poruka_id` — obriši bez izvlačenja.
- Giveawayi prežive restart bota.

---

## Struktura

```
src/
  index.js            # pokretanje, eventi, registracija komandi
  db.js               # JSON baza (data/db.json)
  commands/           # slash komande
  features/           # logika: stats, tickets, invites, members (welcome/autorole/boost), reactionRoles, giveaways
test/                 # npm test, npm run check
```

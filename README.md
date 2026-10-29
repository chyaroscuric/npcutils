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
| 🎵 **Glazba** | `/play` s YouTubea, SoundClouda, playliste ili pretrage; red, loop, shuffle, gumbi za kontrolu |
| 🎮 **Igre** | Pogodi državu (zastave), Wordle, Kaladont, Ship |
| 🔨 **Moderacija** | `/purge`, `/ban`, `/kick`, `/timeout`, `/warn`, `/lock`, `/slowmode`… s logom moderacije |
| 📋 **Kloniranje servera** | Kopira role, kanale, dozvole, profil, emojije i postavke bota s jednog servera na drugi |
| 🛡️ **Anti-nuke** | Kažnjava i vraća masovne banove, kickove, brisanje kanala/rola, dodavanje botova… |
| 🌐 **Dashboard** | Web stranica s Discord prijavom — sve gore navedeno podesiš iz browsera, bez komandi |

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

4. **OAuth2** tab (za dashboard): kopiraj **Client Secret** i pod **Redirects** dodaj `<DASHBOARD_URL>/callback`, npr. `http://localhost:3000/callback` ili `https://bot.tvojadomena.com/callback`.
5. ⚠️ U **Server Settings → Roles** pomakni rolu **Jaankeza Utils** **iznad** svih rola koje bot treba davati (Member, reaction role…). Bot ne može dati rolu koja je iznad njegove.

## 2. Pokretanje

Treba [Node.js](https://nodejs.org) 20.12 ili noviji.

```bash
npm install
```

```bash
cp .env.example .env
```

U `.env` upiši:

- `DISCORD_TOKEN` — token bota
- `PORT`, `CLIENT_SECRET`, `DASHBOARD_URL` — za dashboard (vidi [Dashboard](#-dashboard))
- po želji `GUILD_ID` — ID tvog servera, tada se slash komande pojave odmah

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

**Opcija C — hosting za botove** (Pterodactyl panel, Render, Railway…): postavi env varijable iz `.env.example`. Na `PORT` radi dashboard, a `/health` vraća status (`{"online": true, ...}`) pa ga možeš pingati s UptimeRobotom. Na Pterodactylu kao `PORT` upiši port koji ti je panel dodijelio (allocation), a `DASHBOARD_URL` je `http://IP:PORT` tog servera.

> Na Dockeru/hostingu obavezno sačuvaj `data/` folder (volume), inače se izgube postavke i invite-ovi.

---

## 🌐 Dashboard

Dashboard je web stranica na kojoj se prijaviš Discordom i podesiš sve bez komandi: welcome i boost poruke, autorole, stats kanale, tikete (i zatvaranje otvorenih), invite-ove (bonus, reset), reaction role, giveawaye i glazbu (dodavanje pjesama, pauza, skip, red).

1. U `.env` postavi `PORT` (npr. `3000`), `CLIENT_SECRET` (Developer Portal → OAuth2) i `DASHBOARD_URL` (adresa na kojoj se otvara, npr. `http://localhost:3000`).
2. U Developer Portalu → OAuth2 → Redirects dodaj `DASHBOARD_URL` + `/callback`.
3. Pokreni bota i otvori `DASHBOARD_URL`.

Vidiš samo servere na kojima je bot i na kojima imaš permisiju **Manage Server**. Boju sučelja mijenjaš pod **Izgled** (dolje lijevo).

> Ako dashboard ide na internet, stavi ga iza HTTPS-a (npr. Cloudflare Tunnel ili nginx) i u `DASHBOARD_URL` upiši `https://...`.

## 🎵 Glazba

- `/play pjesma:<naziv ili link>` — naziv pjesme (traži na YouTubeu), YouTube/SoundCloud link ili playlista (do 100 pjesama). Moraš biti u voice kanalu.
- `/skip`, `/pause`, `/resume`, `/stop` (očisti red i izađi), `/queue`, `/loop` (isključeno / pjesma / cijeli red), `/shuffle`, `/remove broj`.
- Ispod poruke "Sada svira" su gumbi ⏯️ ⏭️ ⏹️ 🔁 🔀. Upravljati može samo netko tko je u istom voice kanalu.
- Bot izlazi iz kanala nakon 2 min bez glazbe ili 1 min kad nitko ne sluša.

Treba `ffmpeg` i `yt-dlp`: bot ih sam preuzme u `data/bin` (yt-dlp se jednom dnevno ažurira). Spotify linkovi nisu podržani (Spotify ne dopušta preuzimanje zvuka).

Brzina: bot odmah dobije direktan link na zvuk, ne rekodira YouTubeov Opus i unaprijed priprema iduću pjesmu u redu, pa je prijelaz između pjesama gotovo trenutan. Ako YouTube blokira neki video, bot istu pjesmu automatski potraži na SoundCloudu.

> YouTube ponekad blokira IP adrese hostinga ("Sign in to confirm you're not a bot"). Tada pomaže druga lokacija servera ili SoundCloud linkovi.

---

## 🎮 Igre

- `/zastava [kontinent]` — bot pokaže zastavu, prvi tko u chat upiše državu (hrvatski ili engleski naziv) pobjeđuje. Gumbi **Preskoči**, **Pomoć** i **Igraj ponovno**.
- `/wordle` — pogodi riječ od 5 slova u 6 pokušaja (svatko igra svoju igru, klikom na **Pogodi**).
- `/kaladont start` / `stop` — u tom kanalu svaka poruka od jedne riječi je potez: riječ mora počinjati sa zadnja dva slova prethodne, isti igrač ne smije dvaput zaredom, a tko napiše riječ na **-nt** pobjeđuje. Riječi se provjeravaju u hrvatskom i srpskom rječniku (preuzme se sam u `data/dict`).
- `/ship korisnik1 [korisnik2]` — slika s avatarima i postotkom.

## 🔨 Moderacija

`/purge broj [korisnik] [botovi] [sadrzi]`, `/ban`, `/unban`, `/kick`, `/timeout trajanje` (npr. `10m`, `1d`), `/untimeout`, `/warn`, `/warnings`, `/clearwarns`, `/slowmode`, `/lock`, `/unlock`. Sve akcije idu u kanal postavljen s `/modlog kanal`. Bot ne dopušta kažnjavanje vlasnika ni nekoga s jednakom ili višom rolom.

## 📋 Kloniranje servera

1. Na serveru s kojeg kopiraš (treba **Administrator**): `/klon izvor`
2. Na serveru u koji kopiraš (samo **vlasnik**): `/klon cilj`
3. Na bilo kojem od njih: `/klon pokreni [profil] [emojiji] [postavke_bota]` → bot napiše što će obrisati i napraviti, a klikom na **Obriši i kopiraj** kreće.

Na ciljnom serveru se brišu svi kanali i role, pa se kopiraju role (s redoslijedom i bojama), kategorije i kanali s dozvolama (rola i članova koji su i na cilju), pravila / system kanal, po želji ime i ikona servera, emojiji i postavke ovog bota (welcome, boost, autorole, tiketi, stats, log moderacije, anti-nuke) prebačene na nove kanale i role. Poruke i članovi se ne kopiraju. Bot treba Administrator i rolu na vrhu na oba servera. Ako je komanda pokrenuta u kanalu ciljnog servera, taj se kanal na kraju obriše, a izvještaj stiže u DM.

## 🛡️ Anti-nuke

Štiti server od nekoga tko zloupotrijebi permisije (npr. hakiran admin). Bot prati audit log i, kad netko prijeđe limit, kazni ga (ban / kick / oduzimanje rola / timeout) i vrati štetu: odbanira ljude, obriše spam kanale i role, ponovno napravi obrisane kanale i role, makne opasne role.

| Pravilo | Zadani limit |
| --- | --- |
| Anti ban / kick | 1 |
| Anti role create / channel create | 3 |
| Anti role delete / channel delete | 2 |
| Anti mention (@everyone/@here) | 0 |
| Anti bot add, prune, opasne permisije na roli, dodavanje opasne role | kazna odmah |

Limit znači nakon koliko akcija u vremenskom prozoru (zadano 60 s) slijedi kazna: limit 1 = kazna već kod prve akcije, limit 3 = kod treće. Moderatore koji smiju normalno banati/kickati stavi na whitelist. Uključi s `/antinuke ukljuci ukljuceno:True`, podesi s `/antinuke pravilo`, `/antinuke postavke` i `/antinuke whitelist`, ili na stranici **Anti-nuke** u dashboardu.

- Postavke može mijenjati **samo vlasnik servera**. Vlasnik i sam bot su uvijek izuzeti.
- Rola bota mora biti **na vrhu** popisa rola, inače ne može kazniti nekoga s višom rolom.
- Upozorenje ide u log kanal i vlasniku u DM.

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
  features/           # logika: stats, tickets, invites, members (welcome/autorole/boost), reactionRoles, giveaways, music
  dashboard/          # server.js (Express API + Discord login) i public/ (sučelje)
test/                 # npm test, npm run check
```

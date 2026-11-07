// Semantic groups for the "toplo-hladno" word game. Words in the same group are
// treated as related; the game blends this with edit distance for unknown words.
// All entries are lowercase; the matcher removes diacritics before comparing.
export const SEMANTIC_GROUPS = {
  skola: [
    'škola', 'učenik', 'učenica', 'učitelj', 'učiteljica', 'razred', 'ispit', 'zadatak',
    'knjiga', 'bilježnica', 'olovka', 'kemijska', 'ploča', 'kreda', 'zvono', 'školski',
    'učenje', 'učiti', 'matematika', 'hrvatski', 'lektira', 'domaći', 'ravnatelj', 'đak',
    'student', 'fakultet', 'menza', 'torba', 'pero', 'ocjena', 'pismo', 'čitanje', 'pisanje',
  ],
  obitelj: [
    'obitelj', 'mama', 'tata', 'majka', 'otac', 'brat', 'sestra', 'baka', 'djed', 'sin',
    'kći', 'unuk', 'unuka', 'tetka', 'ujak', 'stric', 'rođak', 'roditelj', 'dijete', 'beba',
    'suprug', 'supruga', 'brak', 'dom', 'kuća',
  ],
  kuca: [
    'kuća', 'stan', 'soba', 'kuhinja', 'kupaonica', 'spavaonica', 'dnevni', 'boravak', 'vrata',
    'prozor', 'krov', 'zid', 'pod', 'stol', 'stolica', 'krevet', 'ormar', 'kauč', 'tepih',
    'lampa', 'ključ', 'brava', 'ograda', 'dvorište', 'balkon', 'podrum', 'tavan',
  ],
  hrana: [
    'hrana', 'kruh', 'mlijeko', 'sir', 'jaje', 'meso', 'riba', 'voće', 'povrće', 'jabuka',
    'banana', 'kruška', 'jagoda', 'krumpir', 'mrkva', 'luk', 'češnjak', 'rajčica', 'krastavac',
    'salata', 'juha', 'varivo', 'pile', 'svinjetina', 'govedina', 'kolač', 'torta', 'sladoled',
    'čokolada', 'bombon', 'sok', 'voda', 'kava', 'čaj', 'vino', 'pivo', 'doručak', 'ručak',
    'večera', 'restoran', 'kuhar', 'recept', 'pećnica', 'tanjur', 'čaša', 'žlica', 'vilica', 'nož',
  ],
  priroda: [
    'priroda', 'šuma', 'drvo', 'stablo', 'grana', 'list', 'trava', 'cvijet', 'rijeka', 'jezero',
    'more', 'planina', 'brdo', 'dolina', 'polje', 'livada', 'kamen', 'stijena', 'pijesak', 'plaža',
    'otok', 'obala', 'val', 'sunce', 'mjesec', 'zvijezda', 'nebo', 'oblak', 'kiša', 'snijeg',
    'vjetar', 'oluja', 'munja', 'grom', 'magla', 'jutro', 'večer', 'noć', 'dan',
  ],
  zivotinje: [
    'životinja', 'pas', 'mačka', 'konj', 'krava', 'svinja', 'ovca', 'koza', 'kokoš', 'pijetao',
    'patka', 'guska', 'puran', 'kunić', 'miš', 'štakor', 'vuk', 'lisica', 'medvjed', 'jelen',
    'srna', 'zec', 'vjeverica', 'ptica', 'golub', 'vrabac', 'sova', 'orao', 'sokol', 'riba',
    'zmija', 'žaba', 'kornjača', 'pčela', 'leptir', 'mrav', 'pauk', 'muha', 'komarac',
  ],
  biljke: [
    'biljka', 'cvijet', 'ruža', 'tulipan', 'ljiljan', 'suncokret', 'kaktus', 'palma', 'bor',
    'jela', 'hrast', 'bukva', 'breza', 'lipa', 'vrba', 'voćka', 'grožđe', 'maslina', 'smokva',
    'limun', 'naranča', 'mandarina', 'trešnja', 'višnja', 'šljiva', 'breskva', 'marelica',
    'orah', 'lješnjak', 'badem',
  ],
  odjeca: [
    'odjeća', 'majica', 'košulja', 'hlače', 'traperice', 'suknja', 'haljina', 'jakna', 'kaput',
    'pulover', 'džemper', 'vesta', 'čarape', 'cipele', 'tenisice', 'čizme', 'sandale', 'šešir',
    'kapa', 'šal', 'rukavice', 'pojas', 'torba', 'novčanik', 'nakit', 'prsten', 'ogrlica',
    'naušnice', 'sat', 'naočale',
  ],
  sport: [
    'sport', 'nogomet', 'košarka', 'rukomet', 'odbojka', 'tenis', 'badminton', 'plivanje',
    'trčanje', 'biciklizam', 'skijanje', 'klizanje', 'borba', 'boks', 'hrvanje', 'teretana',
    'trening', 'utakmica', 'igrač', 'trener', 'lopta', 'gol', 'koš', 'reket', 'skija', 'bicikl',
    'trkač', 'stadion', 'dvorana', 'medalja', 'pobjeda', 'poraz', 'navijač',
  ],
  glazba: [
    'glazba', 'pjesma', 'pjevač', 'pjevačica', 'bend', 'gitara', 'klavir', 'bubanj', 'violina',
    'flauta', 'truba', 'saksofon', 'bas', 'mikrofon', 'koncert', 'album', 'nota', 'ritam',
    'melodija', 'tekst', 'spot', 'radio', 'slušalice', 'zvučnik', 'ples', 'plesač',
  ],
  film: [
    'film', 'kino', 'glumac', 'glumica', 'redatelj', 'scenarij', 'kamera', 'scena', 'uloga',
    'serija', 'epizoda', 'dokumentarac', 'animirani', 'komedija', 'drama', 'horor', 'akcija',
    'ljubav', 'znanstvena', 'fantastika', 'trailer', 'poster', 'gledatelj', 'ekran', 'projektor',
    'televizija', 'daljinski',
  ],
  tehnologija: [
    'tehnologija', 'računalo', 'laptop', 'mobitel', 'telefon', 'tablet', 'tipkovnica', 'miš',
    'ekran', 'monitor', 'procesor', 'memorija', 'disk', 'internet', 'mreža', 'wifi', 'aplikacija',
    'program', 'kod', 'programer', 'softver', 'hardver', 'baterija', 'punjač', 'kabel', 'kamera',
    'robot', 'umjetna', 'inteligencija', 'algoritam', 'podatak', 'server', 'baza',
  ],
  promet: [
    'promet', 'auto', 'automobil', 'autobus', 'vlak', 'tramvaj', 'metro', 'kamion', 'kombi',
    'motocikl', 'bicikl', 'romobil', 'avion', 'helikopter', 'brod', 'čamac', 'trajekt', 'cesta',
    'ulica', 'autocesta', 'pruga', 'kolodvor', 'aerodrom', 'luka', 'parkiralište', 'semafor',
    'znak', 'vozač', 'putnik', 'karta', 'kaciga', 'gorivo', 'benzin', 'dizel',
  ],
  putovanje: [
    'putovanje', 'izlet', 'odmor', 'godišnji', 'hotel', 'hostel', 'apartman', 'kamp', 'plaža',
    'more', 'planina', 'grad', 'selo', 'država', 'europa', 'svijet', 'karta', 'putovnica',
    'kofer', 'ruksak', 'avion', 'vlak', 'autobus', 'turist', 'vodič', 'razglednica', 'suvenir',
    'fotografija', 'avantura',
  ],
  grad: [
    'grad', 'selo', 'naselje', 'ulica', 'trg', 'park', 'zgrada', 'neboder', 'crkva', 'katedrala',
    'muzej', 'kazalište', 'knjižnica', 'škola', 'bolnica', 'pošta', 'banka', 'trgovina',
    'restoran', 'kafić', 'hotel', 'most', 'rijeka', 'promet', 'stanovnik', 'gradonačelnik',
    'općina', 'županija',
  ],
  posao: [
    'posao', 'tvrtka', 'firma', 'ured', 'šef', 'kolega', 'zaposlenik', 'radnik', 'plaća',
    'ugovor', 'sastanak', 'projekt', 'zadatak', 'rok', 'karijera', 'intervju', 'biografija',
    'poslodavac', 'zaposlenje', 'radno', 'vrijeme', 'godišnji', 'pauza', 'kava', 'računalo',
    'telefon', 'email', 'dokument', 'potpis',
  ],
  novac: [
    'novac', 'kuna', 'euro', 'dolar', 'cijena', 'plaća', 'račun', 'banka', 'kartica', 'gotovina',
    'kredit', 'dug', 'kamata', 'porez', 'budžet', 'štednja', 'investicija', 'burza', 'dionica',
    'profit', 'gubitak', 'kupnja', 'prodaja', 'trgovina', 'dućan', 'blagajna', 'popust',
    'novčanik',
  ],
  zdravlje: [
    'zdravlje', 'liječnik', 'doktor', 'bolnica', 'ambulanta', 'pacijent', 'bolest', 'simptom',
    'lijek', 'tableta', 'recept', 'injekcija', 'operacija', 'pregled', 'sestra', 'zubar', 'oko',
    'uho', 'grlo', 'glava', 'trbuh', 'ruka', 'noga', 'srce', 'pluća', 'krv', 'temperatura',
    'prehlada', 'gripa', 'virus', 'cjepivo', 'terapija',
  ],
  tijelo: [
    'tijelo', 'glava', 'lice', 'oko', 'uho', 'nos', 'usta', 'zub', 'jezik', 'vrat', 'rame',
    'ruka', 'prst', 'dlan', 'nokat', 'prsa', 'leđa', 'trbuh', 'noga', 'koljeno', 'stopalo',
    'kosa', 'koža', 'kost', 'mišić', 'srce', 'mozak', 'krv', 'dah', 'glas',
  ],
  emocije: [
    'emocija', 'sreća', 'radost', 'tuga', 'ljutnja', 'bijes', 'strah', 'panika', 'ljubav',
    'mržnja', 'ljubomora', 'zavist', 'ponos', 'sram', 'krivnja', 'tjeskoba', 'stres', 'mir',
    'spokoj', 'nada', 'razočaranje', 'uzbuđenje', 'dosada', 'usamljenost', 'prijateljstvo',
    'povjerenje', 'smijeh', 'plač', 'osmijeh',
  ],
  vrijeme: [
    'vrijeme', 'dan', 'noć', 'jutro', 'podne', 'večer', 'ponoć', 'sat', 'minuta', 'sekunda',
    'tjedan', 'mjesec', 'godina', 'stoljeće', 'proljeće', 'ljeto', 'jesen', 'zima', 'ponedjeljak',
    'utorak', 'srijeda', 'četvrtak', 'petak', 'subota', 'nedjelja', 'siječanj', 'veljača',
    'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad',
    'studeni', 'prosinac',
  ],
  boje: [
    'boja', 'crvena', 'plava', 'zelena', 'žuta', 'narančasta', 'ljubičasta', 'ružičasta',
    'smeđa', 'crna', 'bijela', 'siva', 'zlatna', 'srebrna', 'tamna', 'svijetla',
  ],
  brojevi: [
    'broj', 'jedan', 'dva', 'tri', 'četiri', 'pet', 'šest', 'sedam', 'osam', 'devet', 'deset',
    'sto', 'tisuća', 'milijun', 'prvi', 'drugi', 'treći', 'pola', 'cijeli', 'decimala',
  ],
  drzave: [
    'hrvatska', 'srbija', 'bosna', 'slovenija', 'italija', 'austrija', 'mađarska', 'njemačka',
    'francuska', 'španjolska', 'portugal', 'grčka', 'turska', 'rusija', 'ukrajina', 'poljska',
    'češka', 'slovačka', 'nizozemska', 'belgija', 'švedska', 'norveška', 'finska', 'danska',
    'irska', 'britanija', 'amerika', 'kanada', 'meksiko', 'brazil', 'argentina', 'kina', 'japan',
    'indija', 'australija', 'egipat',
  ],
  religija: [
    'religija', 'vjera', 'bog', 'crkva', 'katedrala', 'molitva', 'svećenik', 'biskup', 'papa',
    'isus', 'marija', 'svetac', 'biblija', 'križ', 'blagoslov', 'misa', 'krštenje', 'vjenčanje',
    'pokop', 'duša', 'raj', 'pakao', 'anđeo', 'đavao', 'post', 'blagdan', 'božić', 'uskrs',
  ],
  politika: [
    'politika', 'vlada', 'predsjednik', 'premijer', 'ministar', 'parlament', 'sabor', 'stranka',
    'izbor', 'glas', 'birač', 'kampanja', 'zakon', 'ustav', 'pravda', 'sud', 'sudac', 'policija',
    'vojska', 'država', 'gradonačelnik', 'oporba', 'koalicija', 'demokracija', 'diktatura',
    'korupcija',
  ],
  rat: [
    'rat', 'mir', 'vojska', 'vojnik', 'general', 'bitka', 'oružje', 'puška', 'pištolj', 'bomba',
    'tenk', 'avion', 'brod', 'neprijatelj', 'saveznik', 'pobjeda', 'poraz', 'žrtva', 'ranjenik',
    'izbjeglica', 'granica', 'obrana', 'napad', 'sukob', 'pregovori', 'primirje',
  ],
  umjetnost: [
    'umjetnost', 'slikar', 'slika', 'platno', 'kist', 'boja', 'skulptura', 'kip', 'galerija',
    'muzej', 'izložba', 'umjetnik', 'djelo', 'remek-djelo', 'apstraktno', 'portret', 'pejzaž',
    'fotografija', 'kamera', 'dizajn', 'arhitektura', 'književnost', 'pjesnik', 'pjesma', 'roman',
    'priča', 'lik', 'radnja', 'stil',
  ],
  komunikacija: [
    'komunikacija', 'razgovor', 'riječ', 'rečenica', 'jezik', 'govor', 'glas', 'poruka', 'pismo',
    'email', 'telefon', 'poziv', 'sastanak', 'dogovor', 'pitanje', 'odgovor', 'objašnjenje',
    'priča', 'šala', 'vic', 'novinar', 'vijest', 'mediji', 'televizija', 'radio', 'novine',
    'internet',
  ],
  igre: [
    'igra', 'igračka', 'društvena', 'karta', 'šah', 'dama', 'monopol', 'kocka', 'žeton', 'potez',
    'pravilo', 'pobjeda', 'poraz', 'natjecanje', 'ekipa', 'tim', 'igrač', 'protivnik', 'zabava',
    'rekreacija', 'puzzle', 'slagalica', 'konzola', 'videoigra', 'kontroler', 'level',
  ],
  more: [
    'more', 'ocean', 'plaža', 'pijesak', 'val', 'obala', 'otok', 'brod', 'čamac', 'riba', 'galeb',
    'sunce', 'ronjenje', 'plivanje', 'sol', 'morska', 'zvijezda', 'meduza', 'koral', 'luka',
    'svjetionik', 'oluja', 'vjetar', 'jedro', 'sidro', 'kapetan', 'mornar',
  ],
};

// Strong pairs that should feel very close even if the groups above are broad.
export const RELATED_PAIRS = [
  ['škola', 'učenik'], ['škola', 'učitelj'], ['učenik', 'učitelj'], ['škola', 'razred'],
  ['more', 'plaža'], ['pas', 'mačka'], ['sunce', 'mjesec'], ['kiša', 'oblak'],
  ['auto', 'cesta'], ['nogomet', 'lopta'], ['glazba', 'pjesma'], ['film', 'kino'],
  ['knjiga', 'čitanje'], ['računalo', 'internet'], ['mobitel', 'telefon'],
  ['novac', 'banka'], ['ljubav', 'srce'], ['sreća', 'osmijeh'], ['tuga', 'plač'],
  ['hrana', 'kuhar'], ['cvijet', 'ruža'], ['šuma', 'drvo'], ['planina', 'skijanje'],
  ['zima', 'snijeg'], ['ljeto', 'more'], ['jutro', 'doručak'], ['noć', 'mjesec'],
  ['pas', 'vuk'], ['mačka', 'tigar'], ['krava', 'mlijeko'], ['pčela', 'med'],
  ['riba', 'more'], ['ptica', 'nebo'], ['vlak', 'kolodvor'], ['avion', 'aerodrom'],
  ['brod', 'luka'], ['bicikl', 'cesta'], ['posao', 'ured'], ['plaća', 'novac'],
  ['liječnik', 'bolnica'], ['bolest', 'lijek'], ['glava', 'mozak'], ['ruka', 'prst'],
  ['noga', 'stopalo'], ['vrijeme', 'sat'], ['godina', 'mjesec'], ['ponedjeljak', 'tjedan'],
  ['crvena', 'boja'], ['jedan', 'broj'], ['hrvatska', 'zagreb'], ['europa', 'država'],
  ['bog', 'crkva'], ['rat', 'vojska'], ['umjetnost', 'slika'], ['glazba', 'koncert'],
  ['igra', 'pravilo'],
];


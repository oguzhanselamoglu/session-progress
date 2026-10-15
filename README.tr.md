# session-progress

[English](README.md) · **Türkçe**

İşinin nasıl ilerlediğini **oturum bazında** gösteren bir Claude Code eklentisi:

<p align="center">
  <img src="docs/images/overview-tr.svg" alt="Bir Claude Code penceresi: prompt üstündeki şerit bu oturumun sende bekleyen paketini gösteriyor; sağdaki Oturumlar paneli dört açık oturumu kart olarak listeliyor, sende bekleyen ikisi en üstte." width="100%">
</p>

- **Prompt üstündeki şerit:** bu oturumun üzerinde çalıştığı iş paketi. Bir çubuk, şu anki aşama ve işin kimi beklediği görünür. Karar
  sende bekliyorsa sarıya döner.
- **`/oturumlar` paneli:** açık her Claude Code oturumu bir kart; sende bekleyenler en üstte. Her kartta paket, ilerleme, aşama şeridi
  (✓ ● ⏸ ○), neyi beklediği ya da şu anki ve sıradaki aşama, alt ajanları, oturumun adı, klasörü ve branch'i vardır (worktree'ler
  işaretli). Hiçbir açık oturumun üzerinde çalışmadığı paketler altta listelenir. Komut paneli açar ve kapatır; başka bir oturum seni
  beklemeye başlayınca panel kendiliğinden de açılır, o oturumda sen kapatana kadar.
- **Alt ajanlar:** şerit ve kartlar oturumun alt ajanlarını gösterir: kaçı çalışıyor, bitti ya da hata verdi ve çalışanların iş
  etiketleri. Alt ajanı arka planda çalışan oturum çalışıyor sayılır.
- **`/ilerleme` paneli:** oturumun paketi tüm ayrıntısıyla. Aşamalar sahibi, süresi, notları, ölçümleri ve bağlantılarıyla; ardından
  denetim turları, diğer aktif paketler ve tamamlananlar.
- **Bildirimler:** paketinin bir aşaması bitince ya da karar sana geçince kısa bir bildirim; **başka** bir oturum seni beklemeye
  başlayınca da: orada bir izin isteği, soru ya da plan onayı açılınca ya da paketinin kararı sana geçince.
- **Açık pencere de beklemedir:** izin isteği, soru ya da plan onayı gösteren oturum, hiçbir pakete bağlı olmasa da `/oturumlar`
  panelinde ve şeridin sayacında sende bekliyor görünür.
- **Diğer projeler (varsayılan kapalı):** `/oturumlar tümü` ile açınca `/oturumlar` diğer projelerdeki açık oturumlarını da paketlerinin
  ilerlemesiyle gösterir; biri seni beklemeye başlayınca bildirim gelir. Bkz. [Diğer projelerdeki oturumlar](#diğer-projelerdeki-oturumlar).

Aynı anda birden çok oturumla (worktree'ler, paralel özellikler, ajanlar) çalışırken hangisinin seni beklediğini tek bakışta görmek
için yapıldı.

<p align="center">
  <img src="docs/images/progress-panel-tr.svg" alt="/ilerleme paneli: çubuğuyla bir paket, sende bekleyen karar, sahibi ve süresiyle her aşama, denetim turları, diğer aktif paketler ve tamamlananlar." width="660">
</p>

### Tipik bir akış

1. Çok adımlı bir değişiklik istersin. Claude planını aşamalar hâlinde `.progress/<paket>/progress.json` dosyasına yazar; o
   oturumun prompt'unun üstünde şerit belirir.
2. Claude aşamalarda ilerledikçe dosyayı günceller; çubuk ve şu anki aşama onu izler.
3. Kararın gerektiğinde Claude aşamayı `waiting-user` yapar: şerit sarıya döner, bir bildirim neyin beklediğini söyler ve oturum diğer
   oturumlardaki `/oturumlar` panelinde de en üste çıkar.
4. Birden çok oturum açıkken (örneğin her worktree için bir tane) `/oturumlar` hangisinin çalıştığını, hangisinin seni beklediğini ve
   hangisinin bittiğini gösterir.

Görsellerdeki bütün adlar uydurma örneklerdir.

## Kurulum

```
/plugin install session-progress --marketplace oguzhanselamoglu/session-progress
```

Bir terminal oturumunda yaz; marketi eklemek için `y` de ve kullanıcı kapsamını seç. Kullanıcı kapsamında masaüstü uygulamasının Code
sekmesinde de yüklenir. Claude Code 2.1.287 ya da üstü gerekir.

Arayüz ilk açılışta İngilizcedir; Türkçeye geçmek için bir kez şunu yaz:

```
/progress language tr
```

**Nerede çalışır:** Claude Code (terminal ve masaüstü uygulamasının Code sekmesi); şerit ve paneller Claude Code arayüzüdür. macOS'ta
denendi; Linux'ta aynı çalışması beklenir, Windows yolları destekleniyor ama Windows'ta henüz denenmedi — geri bildirimlere açığız.

## Hızlı başlangıç

1. Deponda: `/ilerleme kur` — `.progress/` klasörünü oluşturur (projeyle birlikte commit'le). Projede `CLAUDE.md` varsa takibi
   otomatik yapan satırı eklemeyi önerir, yoksa satırı gösterir (bkz. [Kullanım](#kullanım)).
2. Claude'dan birkaç adımlı bir iş iste ve *"bunu planla ve session-progress ile takip et"* de. Claude paket dosyasını yazar; şerit
   prompt'un üstünde belirir.
3. Herhangi bir oturumda `/oturumlar` ile tüm açık oturumları gör; seni bekleyenler en üstte.

## Kullanım

### İşi madde madde ver ve takip iste

Eklentiyle gelen beceri Claude'a paket dosyasını nasıl yazacağını öğretir, ama ne zaman kullanacağına Claude karar verir. Prompt'ta
takip istersen her zaman yazar:

```
Şunları yap ve session-progress ile takip et:
- Login formuna e-posta doğrulaması ekle
- Hata mesajlarını Türkçeleştir
- Testleri yaz
- Merge öncesi onayıma getir
```

Her madde bir **aşama** olur. Şerit başlığı, bir çubuğu, `biten/toplam` sayısını ve şu anki aşamayı gösterir; Claude aşamalara
başlayıp bitirdikçe ilerler, her aşama bitince bir bildirim gelir. Aşama başlıkları Claude'la konuştuğun dilde yazılır.

### Onayını bir adım olarak iste

*"Onayıma getir"* gibi bir madde seni bekleyen bir aşama olur. Claude oraya gelince durur: şerit sarıya döner (**SENDE BEKLİYOR**),
bir bildirim neyin beklediğini söyler ve oturum diğer oturumlardaki `/oturumlar` panelinde en üste çıkar.

### Dosya şemaya uymazsa

`progress.json`'u şemaya uymayan paket, ilerlemesi yerine bir hata satırıyla görünür; birden çok çalışma kopyasında (worktree) bozuk olan
aynı dosya tek satırdır. Denetim turları (`audits`) istisnadır: uymayan tur dışarıda bırakılır, paket yine görünür ve hangi turun
gösterilmediğini soluk bir satır söyler. Claude böyle bir dosya yazınca eklenti ona hemen söyler (dosyayı ve ilk sorunu); Claude dosyayı
aynı turda düzeltir.

### Bir projede otomatik yap

Projenin `CLAUDE.md` dosyasında bu satır varsa Claude o projede çok adımlı işleri sen istemeden takip eder (beceri önce projenin kendi
kurallarına uyar):

```md
Çok adımlı işleri (3+ adım) session-progress ile takip et.
```

`/ilerleme kur` bu satırı, kullandığın dilde, mevcut bir `CLAUDE.md` (ya da `.claude/CLAUDE.md`) dosyasına eklemeyi önerir: satırı
olduğu gibi gösterip önce sorar; yalnızca "evet" dersen sonuna eklenir — asla iki kez değil; dosya zaten session-progress'ten söz
ediyorsa hiç sormaz. Reddedersen satırı senin eklemen için gösterir. Yeni bir `CLAUDE.md` oluşturmaz; dosya yoksa satırı
eklemen için gösterir. Bir sonraki oturumdan itibaren geçerli olur.

### Birden çok oturum

- Kartları kolay ayırt etmek için her oturuma ad ver: `/ilerleme ad API işi`.
- Herhangi birinde `/oturumlar`'ı aç: seni bekleyenler en üstte, neyi beklediğiyle (bir paketin kararı, bir izin isteği, bir soru ya da
  bir plan onayı). Başka bir oturum seni beklemeye başlayınca burada da bildirim çıkar.
- Aynı deponun farklı worktree'lerindeki oturumlar birbirini görür. Başka depolardaki oturumlar yalnız diğer projeleri açarsan görünür
  (sonraki bölüm).

### Diğer projelerdeki oturumlar

**Varsayılan olarak kapalı.** `/oturumlar` içinde bulunduğun deponun oturumlarını gösterir. Diğer projelerdeki oturumlarını da izlemek
için diğer projeleri herhangi bir oturumdan aç:

```
/oturumlar tümü    # aç     (English: /sessions all)
/oturumlar bu      # kapat  (English: /sessions this)
```

Bu seçim projenin değil senindir: eklentinin kendi deposunda tutulur ve tüm oturumlarında geçerli olur (zaten açık olanlar 30 saniye
içinde fark eder). İki dilin kelimesi de çalışır.

Açıkken:

- `/oturumlar`, bu projenin oturumlarının altında bir **Diğer projeler** bölümü gösterir: açık oturumu olan her proje ve her oturum,
  buradakiyle aynı kartla (durum, sende bekleyen pencere, bağlı paket ve ilerleme çubuğu, aşamalar, şu an ne yapıldığı ve sıradaki,
  alt ajanlar, branch). Sende bir şey bekleyen projeler önce gelir; panelin en üstündeki bir satır da bunu söyler.
- Başka bir projedeki oturum seni beklemeye başlayınca (bir izin isteği, bir soru, onaylanacak bir plan ya da paketinin kararı) projeyi
  ve oturumu adıyla anan bir bildirim gelir: `⏸ shop › API işi: sende bekliyor — soru`. Şeritteki "başka oturumda sende bekliyor"
  sayacı bunları da sayar ve oturumlar paneli, bu projede olduğu gibi kendiliğinden açılır.
- Diğerlerinin görebilmesi için açık oturumu olan her proje, Claude Code yapılandırma klasörüne küçük bir dosya yazar:
  `~/.claude/session-progress/projects/<klasör>-<hash>.json` (`$CLAUDE_CONFIG_DIR` tanımlıysa onun altında). İçinde projenin yolu,
  paket klasörü, kabul ettiği şema adları ve en son ne zaman görüldüğü vardır — başka bir şey yok. Bütün oturumları kapanan proje birkaç
  dakika sonra gösterilmez olur.

Panelin son satırı diğer projelerin açık mı kapalı mı olduğunu ve nasıl değiştirileceğini her zaman söyler. Kapatınca proje dışına
yazma hemen durur (diğer açık oturumlarda bir sonraki sinyalde). Geride kalan proje dosyaları birkaç dakika eskiyince yok sayılır;
`~/.claude/session-progress/` klasörünü istediğin zaman silebilirsin.

Yalnız eklentiyi kullanan projeler (paket klasörü olanlar) ve bu özelliği içeren sürümü çalıştıran oturumlar katılır.

### İpuçları

- En iyisi 3–8 anlamlı madde: çubuk biten aşamalara göre ilerler, çok ince adımlar gürültü yapar.
- Her iş için bir paket. Tamamlanan pakete bir daha bağlanılmaz; yeni iş yeni paket alır.
- `/ilerleme` paketi tüm ayrıntısıyla gösterir: her aşamanın sahibi, süresi, notları ve bağlantıları.

## Nasıl çalışır

Her paket tek bir JSON dosyasıdır: `<packagesDir>/<paket>/progress.json`. İş aşamalarda ilerledikçe ajan bu dosyayı yazar. Eklentiyle
gelen beceri Claude'a dosyayı ne zaman ve nasıl yazacağını söyler; çoğu projede başka bir şey gerekmez.

Bir oturum, kendi araç çağrısı bir paketin `progress.json`'unu yazdığında o pakete **bağlanır**. Write/Edit ile ya da yolu adıyla anan ve
dosyayı gerçekten değiştiren bir Bash komutuyla bağlanır. Dosyayı okumak bağlamaz. Tamamlanmış pakete otomatik bağlanılmaz. Elle
bağlamak için `/ilerleme bağla <paket>`.

Her oturum `<ana depo>/.git/session-progress/sessions/` altında küçük bir kayıt tutar. `.git` klasörü bütün worktree'lerde ortaktır ve
git onu izlemez. Oturumlar paneli bu kayıtlardan kurulur. Kayıt oturum başında, her turun başında ve sonunda, bir pencere açılıp
kapanınca, bir alt ajan başlayıp bitince ve 30 saniyede bir tazelenir. Diğer oturumların kayıtları 5 saniyede bir okunur (dosyası
değişmeyen kayıt yeniden okunmaz); böylece bir oturumdaki pencere diğerlerine saniyeler içinde ulaşır. 3 dakikadır ses vermeyen ya da
kapanmış oturum kapalı sayılır. Kayıtlar yalnızca paket klasörü olan depolarda yazılır; başka
projelere dokunulmaz. Diğer projeler açıkken (`/oturumlar tümü`, varsayılan kapalı) böyle her proje Claude Code yapılandırma klasörüne
küçük bir dosya da bırakır ve her oturum diğer projelerin kayıtlarını aynı şekilde okur.

### Neyi okur, neyi yazar

Her şey senin makinende kalır: eklenti ağ isteği yapmaz ve hiçbir kimlik bilgisini okumaz.

| | Yol | Neden |
|---|---|---|
| okur | ana checkout'ta ve her worktree'de `<packagesDir>/*/progress.json` | gösterdiği paketler |
| okur | `.claude/session-progress.json` | projenin ayarları |
| okur | `.git` (dosya ya da klasör) ve `.git/worktrees/*/gitdir` | ana checkout'u ve worktree'lerini bulmak için |
| okur | checkout'un git `HEAD` dosyası | branch'i, oturumun kartında gösterilir |
| yazar | `.git/session-progress/sessions/<oturum kimliği>.json` | oturum başına küçük bir kayıt: ad, checkout, bağlı paket, son sinyal, branch, worktree olup olmadığı, sende açık pencerenin türüyle aracın adı (`izin: Bash`; komut ya da aracın girdisi asla yazılmaz) ve alt ajanlarının kısa iş etiketleriyle durumları (prompt'ları asla). Git, `.git` içindeki tanımadığı klasörleri yok sayar; hiçbir şey commit'lenmez. Yalnız paket klasörü olan depolarda yazılır. |
| yazar | `<packagesDir>/README.md` | yalnız `/ilerleme kur` çalıştırınca ve mevcut bir klasörün üzerine asla |
| okur | `~/.claude/session-progress/projects/*.json`, sonra listelenen her projenin `.git/session-progress/sessions/*.json` dosyaları ve açık oturumlarının bağlı olduğu `progress.json` | yalnız diğer projeler açıkken (`/oturumlar tümü`): diğer projelerindeki oturumlar ve paketler |
| okur | `CLAUDE_CONFIG_DIR`, `HOME` ve `USERPROFILE` ortam değişkenleri | Claude Code yapılandırma klasörünü bulmak için |
| yazar | `~/.claude/session-progress/projects/<klasör>-<hash>.json` | yalnız diğer projeler açıkken: projenin yolu, paket klasörü, kabul ettiği şema adları ve en son ne zaman görüldüğü; diğer projelerdeki oturumların onu bulabilmesi için |
| yazar | `CLAUDE.md` ya da `.claude/CLAUDE.md` | yalnız `/ilerleme kur` çalıştırınca, dosya zaten varsa ve sorulduğunda "evet" dersen: sonuna bir satır eklenir (bkz. [Kullanım](#kullanım)); session-progress'ten söz eden dosyaya dokunulmaz |

Bunlardan yalnız `CLAUDE.md` Claude'un talimat olarak izlediği bir dosyadır ve eklenti ona yalnız sen evet dersen ekler.
`.git/session-progress/` altındaki oturum kayıtlarını yalnız eklentinin kendisi (açık her oturumdaki kopyası) okur; başka hiçbir araç
onları çalıştırmaz ya da onlara uymaz.

Kancalar: Write, Edit, NotebookEdit ve Bash üzerindeki `tool.call` yalnız bir çağrının paketin `progress.json`'unu yazıp yazmadığını
**izler** (oturumu bağlamak için); hiçbir çağrıyı değiştirmez, geciktirmez ya da engellemez. `session.start`, `session.end`,
`turn.start` ve `turn.complete` oturum kaydını güncel tutar. `classic.Notification` yalnız Claude Code'un bir izin isteminin açıldığını
bildiren kendi bildirimini **izler** (`permission_prompt`; ondan yalnız aracın adı alınır), bütün araçlardaki `tool.call` de yalnız bir
sorunun ya da onaylanacak bir planın ne zaman açıldığını ve bir çağrının ne zaman bittiğini **izler** (oturumu bekliyor göstermek için).
**Eklentinin hiçbir kancası bir izin denetiminde çalışmaz:** hiçbiri bir istemi ya da çağrıyı cevaplamaz, değiştirmez, geciktirmez ya da
engellemez; bildirim olduğu gibi geçer. Agent üzerindeki aynı `tool.call` ve `classic.SubagentStop` yalnız bir alt
ajanın ne zaman başlayıp bittiğini **izler**; SubagentStop'un sonucu olduğu gibi geçer. `classic.PostToolUse`, çağrının az önce
**yazdığı** bir `progress.json`'u denetler (yalnızca okuduğunu asla): şemaya uymuyorsa Claude için dosyayı ve ilk sorunu söyleyen tek
bir satır ekler, böylece yazan onu aynı turda düzeltir; aracın sonucu asla değişmez. `ui.render` şeridi ve iki paneli çizer. Eklenti iki komut kaydeder
(`/ilerleme`, `/oturumlar`; İngilizcede `/progress`, `/sessions`) ve dil ile diğer projeler seçimini kendi deposunda tutar.

### `progress.json`

```json
{
  "schema": "session-progress-v1",
  "package": "login-flow",
  "title": "SMS kodlu giriş akışı",
  "updatedAt": "2026-10-10T09:41:00Z",
  "phases": [
    { "id": "plan", "title": "Plan", "status": "done", "startedAt": "2026-10-10T08:00:00Z", "finishedAt": "2026-10-10T08:20:00Z" },
    { "id": "approve", "title": "Plan onayı", "status": "waiting-user", "owner": "user" },
    { "id": "build", "title": "Geliştirme", "status": "pending", "owner": "claude" }
  ],
  "waitingOn": { "who": "user", "what": "Planı onayla" }
}
```

- **Durumlar:** `pending`, `active`, `waiting-user`, `waiting-external`, `blocked`, `done`, `skipped`.
- **Sahipler:** `owner` ve `waitingOn.who` serbest etikettir. `user` sen demektir ve vurgulanır.
- **Aşama başına isteğe bağlı:** `startedAt`, `finishedAt`, `note`, `refs`, `metrics`.
- **Paket başına isteğe bağlı:** `branch`, `worktree` ve `audits` (denetim turları: `round`, `by`, `verdict`, `findings`, `closedBy`,
  `at`).

Kuralların tamamı [`skills/session-progress/SKILL.md`](skills/session-progress/SKILL.md) dosyasında (İngilizce).

## Ayarlar

**Proje başına:** deponun kökünde `.claude/session-progress.json` oluştur ve commit'le. Her alan isteğe bağlıdır.

```json
{
  "packagesDir": "docs/work-packages",
  "ownerLabels": { "qa": "Test ekibi", "claude": "Claude" }
}
```

| Alan | Varsayılan | Anlamı |
|---|---|---|
| `packagesDir` | `.progress` | Her paket için bir alt klasör tutan klasör, köke göre. |
| `ownerLabels` | yok | Sahip etiketlerinin görünen adları. `user` her zaman SEN olarak gösterilir. |
| `schemaAliases` | yok | `session-progress-v1` gibi okunacak başka `schema` adları (ad değişikliğinden önceki dosyalar). |

## Dil

Varsayılan dil İngilizcedir. Herkes kendisi değiştirebilir; seçim sonraki tüm oturumlarında geçerli kalır:

```
/progress language tr     # Türkçeye
/ilerleme dil en          # İngilizceye geri
```

Şerit, iki panel ve komut adları o anki oturumda hemen değişir.

| Dil | Komutlar | Alt komutlar |
|---|---|---|
| English | `/progress`, `/sessions` | `/progress`: `init` · `refresh` · `bind <package>` · `unbind` · `name <name>` · `language en\|tr` — `/sessions`: `all` · `this` |
| Türkçe | `/ilerleme`, `/oturumlar` | `/ilerleme`: `kur` · `yenile` · `bağla <paket>` · `çöz` · `ad <ad>` · `dil en\|tr` — `/oturumlar`: `tümü` · `bu` |

Alt komutlar iki dilde de anlaşılır; diğer dilin kelimesini yazsan da çalışır. Claude'un `progress.json`'a yazdığı başlıklar ve notlar,
onunla konuştuğun dilde olur.

**Yeni bir dil eklemek:** bütün metinler [`hooks/i18n.ts`](hooks/i18n.ts) dosyasında, her dil için tipli bir sözlük olarak durur. `en`
sözlüğünü kopyala, çevir, komut adlarını seç ve dil kodunu `LANGS` listesine ekle. Unuttuğun her metni tip kontrolü gösterir. Katkılara
açığız.

## Geliştirme

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .            # çalışma kopyasıyla bir oturum aç
```

Saf çekirdek motora erişmez ve doğrudan birim testleriyle sınanır:

- `hooks/model.ts`: şema, ilerleme, süreler, bildirimler.
- `hooks/sessions.ts`: oturum kayıtları, bağlama, sıralama.
- `hooks/i18n.ts`: bütün metinler, iki dilde.

Kancalar `hooks/register.tsx` dosyasındadır. README görselleri uydurma veriyle `python3 scripts/make-readme-images.py` tarafından
çizilir; görünür bir değişiklikten sonra yeniden çalıştır.

## Lisans

MIT

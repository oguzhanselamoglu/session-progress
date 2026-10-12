# Privacy

session-progress collects nothing and sends nothing. It makes no network requests.

It runs inside Claude Code on your machine and only reads and writes files there:

- It reads the work package files (`progress.json`) and the project's `.claude/session-progress.json` in your repository, and the
  `.git` entries that list your worktrees.
- It writes one small record per Claude Code session under `.git/session-progress/sessions/` (session name, checkout folder, bound
  package, last activity time, and whether a permission prompt, a question or a plan approval is open, with the tool's name only —
  never a command or a tool's input). Git does not track these files. Delete the folder at any time.
- When you run `/progress init` and the project already has a `CLAUDE.md` (or `.claude/CLAUDE.md`), it appends one line asking Claude
  to track multi-step work with session-progress, unless the file already mentions it. It never creates that file.
- It keeps your language choice in the plugin's own local store in your Claude Code configuration folder.

No data leaves your machine, and no credentials are read.

---

**Türkçe:** session-progress hiçbir veri toplamaz ve hiçbir yere göndermez; ağ isteği yapmaz. Yalnızca senin makinende, deponun
dosyalarını okur ve `.git/session-progress/sessions/` altına oturum başına küçük bir kayıt yazar (açık bir izin isteği,
soru ya da plan onayı varsa yalnız türü ve aracın adı; komut ya da aracın girdisi asla; git bunları izlemez, klasörü istediğin
zaman silebilirsin). `/ilerleme kur` çalıştırınca, projede zaten bir
`CLAUDE.md` (ya da `.claude/CLAUDE.md`) varsa ve session-progress'ten söz etmiyorsa sonuna tek bir satır ekler; bu dosyayı asla
oluşturmaz. Dil seçimin, Claude Code yapılandırma klasöründeki eklentiye ait yerel depoda tutulur. Hiçbir kimlik bilgisi okunmaz.

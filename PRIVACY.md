# Privacy

session-progress collects nothing and sends nothing. It makes no network requests.

It runs inside Claude Code on your machine and only reads and writes files there:

- It reads the work package files (`progress.json`) and the project's `.claude/session-progress.json` in your repository, and the
  `.git` entries that list your worktrees.
- It writes one small record per Claude Code session under `.git/session-progress/sessions/` (session name, checkout folder, bound
  package, last activity time). Git does not track these files. Delete the folder at any time.
- It keeps your language choice in the plugin's own local store in your Claude Code configuration folder.

No data leaves your machine, and no credentials are read.

---

**Türkçe:** session-progress hiçbir veri toplamaz ve hiçbir yere göndermez; ağ isteği yapmaz. Yalnızca senin makinende, deponun
dosyalarını okur ve `.git/session-progress/sessions/` altına oturum başına küçük bir kayıt yazar (git bunları izlemez, klasörü istediğin
zaman silebilirsin). Dil seçimin, Claude Code yapılandırma klasöründeki eklentiye ait yerel depoda tutulur. Hiçbir kimlik bilgisi okunmaz.

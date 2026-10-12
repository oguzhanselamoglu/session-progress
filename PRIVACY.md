# Privacy

session-progress collects nothing and sends nothing. It makes no network requests.

It runs inside Claude Code on your machine and only reads and writes files there:

- It reads the work package files (`progress.json`) and the project's `.claude/session-progress.json` in your repository, the
  `.git` entries that list your worktrees, and the checkout's git `HEAD` (its branch).
- It writes one small record per Claude Code session under `.git/session-progress/sessions/` (session name, checkout folder, bound
  package, last activity time, and whether a permission prompt, a question or a plan approval is open, with the tool's name only —
  never a command or a tool's input; the branch; and its subagents' short task labels and states — never their prompts). Git does not track these files. Delete the folder at any time.
- When you run `/progress init` and the project already has a `CLAUDE.md` (or `.claude/CLAUDE.md`), it offers to append one line asking
  Claude to track multi-step work with session-progress — shown word for word, added only if you say yes, and not offered when the
  file already mentions it. It never creates that file.
- When Claude itself writes a `progress.json` that does not match the schema, it adds one line to Claude's context naming that file
  and the problem, so Claude fixes it. Nothing else is added to the conversation.
- It keeps your language choice in the plugin's own local store in your Claude Code configuration folder.

No data leaves your machine, and no credentials are read.

---

**Türkçe:** session-progress hiçbir veri toplamaz ve hiçbir yere göndermez; ağ isteği yapmaz. Yalnızca senin makinende, deponun
dosyalarını okur ve `.git/session-progress/sessions/` altına oturum başına küçük bir kayıt yazar (açık bir izin isteği,
soru ya da plan onayı varsa yalnız türü ve aracın adı; komut ya da aracın girdisi asla; branch; alt ajanların kısa iş etiketleri ve durumları, prompt'ları asla; git bunları izlemez, klasörü istediğin
zaman silebilirsin). `/ilerleme kur` çalıştırınca, projede zaten bir
`CLAUDE.md` (ya da `.claude/CLAUDE.md`) varsa ve session-progress'ten söz etmiyorsa sonuna tek bir satır eklemeyi önerir; satırı
olduğu gibi gösterir ve yalnızca "evet" dersen ekler; bu dosyayı asla oluşturmaz. Claude'un yazdığı bir `progress.json` şemaya uymazsa,
Claude'un bağlamına dosyayı ve sorunu söyleyen tek bir satır ekler; konuşmaya başka hiçbir şey eklemez. Dil seçimin, Claude Code yapılandırma klasöründeki eklentiye ait yerel depoda tutulur. Hiçbir kimlik bilgisi okunmaz.

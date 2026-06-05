import { useState, useEffect, useRef } from "react";

const SUPABASE_URL = "https://evajlksybjhnqvrykimf.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2YWpsa3N5YmpobnF2cnlraW1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NzY4NjgsImV4cCI6MjA5NjI1Mjg2OH0.WAdG0kvqXNPtgivfZwPxFDOUnmnEk95rYokK0gSRXa4";

const db = {
  async getAll() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?order=added_at.desc`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
    });
    return res.json();
  },
  async insert(w) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vocabulary`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ word: w.word, word_sr: w.wordSr, translation: w.translation, ipa: w.ipa, part_of_speech: w.partOfSpeech, synonyms: w.synonyms, sentences: w.sentences, notes: w.notes, status: "new", review_count: 0 })
    });
    const data = await res.json();
    return data[0];
  },
  async updateStatus(id, status, reviewCount, learnedAt) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status, review_count: reviewCount + 1, ...(learnedAt ? { learned_at: learnedAt } : {}) })
    });
  },
  async updateSentences(id, sentences) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sentences })
    });
  },
  async updateTranslation(id, wordSr) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ word_sr: wordSr, translation: wordSr })
    });
  },
  async delete(id) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "DELETE",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
    });
  }
};

function normalize(r) {
  return { id: r.id, word: r.word, wordSr: r.word_sr, translation: r.word_sr || r.translation, ipa: r.ipa || "", partOfSpeech: r.part_of_speech, synonyms: r.synonyms || [], sentences: r.sentences || [], notes: r.notes || "", status: r.status || "new", addedAt: r.added_at, reviewCount: r.review_count || 0, learnedAt: r.learned_at };
}

function formatDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("sr-RS", { day: "2-digit", month: "short", year: "numeric" });
}

function highlightWord(sentence, word) {
  if (!word || !sentence) return sentence;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = sentence.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? <strong key={i} style={{ color: "#fff", fontWeight: 700 }}>{part}</strong> : part
  );
}

export default function VocabTracker() {
  const [words, setWords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);
  const [view, setView] = useState("list");
  const [wordInput, setWordInput] = useState("");
  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [popup, setPopup] = useState(null);
  const [quickAdding, setQuickAdding] = useState(false);
  const [editingTranslation, setEditingTranslation] = useState(false);
  const [editTranslationVal, setEditTranslationVal] = useState("");
  const debounceRef = useRef(null);

  useEffect(() => {
    db.getAll().then(rows => {
      if (Array.isArray(rows)) setWords(rows.map(normalize));
      else setDbError("Greška pri učitavanju. Provjeri Supabase RLS podešavanja.");
      setLoading(false);
    }).catch(() => { setDbError("Ne mogu se spojiti na bazu."); setLoading(false); });
  }, []);

  const showToast = (msg, color = "#22c55e") => { setToast({ msg, color }); setTimeout(() => setToast(null), 2500); };

  const callAI = async (prompt, maxTokens = 650) => {
    const res = await fetch("/api/claude", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] })
    });
    const data = await res.json();
    const text = data.content?.find(b => b.type === "text")?.text || "";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  };

  const LOOKUP_PROMPT = (word) => `You are a dictionary for a Serbian B1 English learner. User typed: "${word}". Detect if English or Serbian. RULE: wordEn MUST always be the English word/phrase, wordSr MUST always be the Serbian word/phrase. If user typed Serbian, translate to English for wordEn. If user typed English, translate to Serbian for wordSr. Include 3-10 English synonyms (only real synonyms, as many as truly exist). 5 natural example sentences in English with Serbian translations, varied contexts. Reply ONLY valid JSON, no markdown:\n{"wordEn":"ENGLISH word","wordSr":"SRPSKA rec","partOfSpeech":"type","ipa":"/IPA pronunciation/","synonyms":["syn1","syn2","syn3"],"sentences":[{"en":"s1","sr":"p1"},{"en":"s2","sr":"p2"},{"en":"s3","sr":"p3"},{"en":"s4","sr":"p4"},{"en":"s5","sr":"p5"}]}`;

  const lookupWord = async (word) => {
    if (!word.trim() || word.trim().length < 2) { setAiData(null); return; }
    const cached = words.find(w => w.word.toLowerCase() === word.trim().toLowerCase() || w.wordSr?.toLowerCase() === word.trim().toLowerCase());
    if (cached) { setAiData({ wordEn: cached.word, wordSr: cached.wordSr, ipa: cached.ipa, translation: cached.translation, partOfSpeech: cached.partOfSpeech, synonyms: cached.synonyms, sentences: cached.sentences }); return; }
    setAiLoading(true); setAiError(null); setAiData(null);
    try { setAiData(await callAI(LOOKUP_PROMPT(word.trim()))); }
    catch (e) { setAiError("Greška pri učitavanju. Pokušaj ponovo."); }
    setAiLoading(false);
  };

  const regenerateSentences = async (word, setter, currentSentences) => {
    setRegenLoading(true);
    try {
      const parsed = await callAI(`3 NEW sentences for "${word}", NOT these:\n${currentSentences?.map(s => "- " + (s.en || s)).join("\n")}\nReply ONLY JSON array:\n[{"en":"...","sr":"..."},{"en":"...","sr":"..."},{"en":"...","sr":"..."}]`, 400);
      setter(parsed);
      showToast("Nove rečenice generisane ✓");
    } catch (e) { showToast("Greška, pokušaj ponovo", "#ef4444"); }
    setRegenLoading(false);
  };

  const handleWordInput = (val) => {
    setWordInput(val); setAiData(null); setAiError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length >= 2) debounceRef.current = setTimeout(() => lookupWord(val), 700);
  };

  const addWord = async () => {
    if (!wordInput.trim() || !aiData) return;
    const duplicate = words.find(w => w.word.toLowerCase() === (aiData.wordEn || wordInput.trim()).toLowerCase());
    if (duplicate) { showToast("Reč već postoji!", "#f59e0b"); return; }
    setSaving(true);
    try {
      const row = await db.insert({ word: aiData.wordEn || wordInput.trim(), wordSr: aiData.wordSr, translation: aiData.wordSr, ipa: aiData.ipa || "", partOfSpeech: aiData.partOfSpeech, synonyms: aiData.synonyms || [], sentences: aiData.sentences, notes: notes.trim() });
      if (row) setWords(prev => [normalize(row), ...prev]);
      setWordInput(""); setAiData(null); setNotes(""); setView("list");
      showToast("Reč sačuvana u bazu ✓");
    } catch (e) { showToast("Greška pri čuvanju", "#ef4444"); }
    setSaving(false);
  };

  const handleQuickAdd = async (word) => {
    if (!word || word.trim().length < 2) return;
    const already = words.find(w => w.word.toLowerCase() === word.trim().toLowerCase() || w.wordSr?.toLowerCase() === word.trim().toLowerCase());
    if (already) { showToast("Već postoji u rečniku!", "#f59e0b"); setPopup(null); return; }
    setQuickAdding(true); setPopup(null);
    try {
      const ai = await callAI(LOOKUP_PROMPT(word.trim()));
      const row = await db.insert({ word: ai.wordEn || word.trim(), wordSr: ai.wordSr, translation: ai.wordSr, ipa: ai.ipa || "", partOfSpeech: ai.partOfSpeech, synonyms: ai.synonyms || [], sentences: ai.sentences, notes: "" });
      if (row) setWords(prev => [normalize(row), ...prev]);
      showToast(`"${ai.wordEn}" dodato u rečnik ✓`);
    } catch (e) { showToast("Greška, pokušaj ponovo", "#ef4444"); }
    setQuickAdding(false);
  };

  const updateStatus = async (id, status) => {
    const w = words.find(x => x.id === id);
    const learnedAt = status === "known" ? new Date().toISOString() : null;
    await db.updateStatus(id, status, w?.reviewCount || 0, learnedAt);
    setWords(prev => prev.map(x => x.id === id ? { ...x, status, reviewCount: (x.reviewCount || 0) + 1, learnedAt: learnedAt || x.learnedAt } : x));
  };

  const deleteWord = async (id) => {
    await db.delete(id); setWords(prev => prev.filter(x => x.id !== id)); setView("list");
    showToast("Obrisano", "#ef4444");
  };

  const speak = (text) => {
    if (!text) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = "en-US"; utt.rate = 0.9; utt.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(v => v.lang === "en-US" && v.name.includes("Google")) || voices.find(v => v.lang === "en-US");
    if (enVoice) utt.voice = enVoice;
    window.speechSynthesis.speak(utt);
  };

  const exportPDF = () => {
    const filterLabel = { all: "Sve reči", new: "Novo", learning: "Učim", known: "Znam" }[filter];
    const html = `<style>body{font-family:Georgia,serif;color:#111;padding:40px;max-width:800px;margin:0 auto}h1{font-size:28px;margin-bottom:4px}.subtitle{color:#888;font-size:13px;margin-bottom:32px}.word-block{border:1px solid #ddd;border-radius:10px;padding:20px;margin-bottom:20px;page-break-inside:avoid}.word{font-size:22px;font-style:italic;font-weight:700;margin-bottom:4px}.translation{font-size:16px;color:#333;margin-bottom:4px}.pos{font-size:11px;color:#999;font-family:monospace;margin-bottom:12px}.section-label{font-size:10px;letter-spacing:2px;color:#6366f1;text-transform:uppercase;margin-bottom:6px;margin-top:10px}.synonyms{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.syn-tag{background:#f0f0ff;border:1px solid #c7d2fe;color:#4338ca;padding:2px 10px;border-radius:20px;font-size:12px;font-style:italic}.sentence{border-left:3px solid #6366f1;padding:8px 12px;margin-bottom:8px;background:#f8f8ff;border-radius:0 6px 6px 0}.sentence-en{font-size:13px;margin-bottom:2px}.sentence-sr{font-size:12px;color:#666;font-style:italic}.notes{font-size:12px;color:#888;font-style:italic;border-top:1px solid #eee;padding-top:8px;margin-top:8px}.meta{font-size:10px;color:#bbb;font-family:monospace;margin-top:8px}.status-new{border-left:4px solid #3b82f6}.status-learning{border-left:4px solid #f59e0b}.status-known{border-left:4px solid #22c55e}</style>
    <h1>Vokabular Tracker</h1><div class="subtitle">Export: ${filterLabel} · ${filteredWords.length} reči · ${new Date().toLocaleDateString("sr-RS")}</div>
    ${filteredWords.map(w => `<div class="word-block status-${w.status}"><div class="word">${w.word}${w.ipa ? ` <span style="font-size:13px;color:#6366f1;font-family:monospace;font-style:normal">${w.ipa}</span>` : ""}</div><div class="translation">${w.wordSr || w.translation || ""}</div>${w.partOfSpeech ? `<div class="pos">${w.partOfSpeech}</div>` : ""}${w.synonyms?.length ? `<div class="section-label">Sinonimi</div><div class="synonyms">${w.synonyms.map(s => `<span class="syn-tag">${s}</span>`).join("")}</div>` : ""}${w.sentences?.length ? `<div class="section-label">Primeri</div>${w.sentences.map(s => `<div class="sentence"><div class="sentence-en">${s.en || s}</div>${s.sr ? `<div class="sentence-sr">↳ ${s.sr}</div>` : ""}</div>`).join("")}` : ""}${w.notes ? `<div class="notes">📝 ${w.notes}</div>` : ""}<div class="meta">Dodano: ${formatDate(w.addedAt)}${w.learnedAt ? ` · Naučeno: ${formatDate(w.learnedAt)}` : ""}</div></div>`).join("")}`;
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:9999;background:#fff;";
    document.body.appendChild(iframe);
    iframe.contentDocument.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`);
    iframe.contentDocument.close();
    setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); iframe.contentWindow.onafterprint = () => document.body.removeChild(iframe); }, 600);
  };

  const handleTextSelection = (e) => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (text && text.length >= 2 && text.length <= 60) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setPopup({ word: text, x: rect.left + rect.width / 2, y: rect.top - 10 });
    }
  };

  const handleWordClick = (e, word) => {
    e.stopPropagation();
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;
    const clean = word.replace(/[^a-zA-ZčćžšđČĆŽŠĐ\s'-]/g, "").trim();
    if (!clean || clean.length < 2) return;
    const rect = e.target.getBoundingClientRect();
    setPopup({ word: clean, x: rect.left + rect.width / 2, y: rect.top - 10 });
  };

  const ClickableSentence = ({ text, highlightTarget }) => {
    const tokens = text.split(/(\s+)/);
    return (
      <span onMouseUp={e => {
        const sel = window.getSelection();
        const selected = sel?.toString().trim();
        if (selected && selected.length >= 2 && selected.length <= 60) {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          setPopup({ word: selected, x: rect.left + rect.width / 2, y: rect.top - 10 });
        }
      }}>
        {tokens.map((token, i) => {
          if (/^\s+$/.test(token)) return <span key={i}>{token}</span>;
          const clean = token.replace(/[^a-zA-ZčćžšđČĆŽŠĐ'-]/g, "");
          const isHighlighted = highlightTarget && clean.toLowerCase() === highlightTarget.toLowerCase();
          return (
            <span key={i} onClick={e => handleWordClick(e, clean)}
              style={{ cursor: "pointer", borderBottom: "1px dotted rgba(99,102,241,0.4)", borderRadius: 2, padding: "0 1px", fontWeight: isHighlighted ? 700 : "normal", color: isHighlighted ? "#fff" : "inherit" }}
              onMouseEnter={e => e.target.style.background = "rgba(99,102,241,0.2)"}
              onMouseLeave={e => e.target.style.background = "transparent"}
            >{token}</span>
          );
        })}
      </span>
    );
  };

  const SentenceCard = ({ s, i, word }) => (
    <div style={{ background: "rgba(99,102,241,0.07)", borderLeft: "2px solid #6366f1", padding: "10px 14px", borderRadius: "0 8px 8px 0", marginBottom: 10 }}>
      <div style={{ fontSize: 14, lineHeight: 1.65, color: "#d0cbc4", marginBottom: 4, display: "flex", alignItems: "flex-start", gap: 6 }}>
        <span style={{ color: "#6366f1", fontFamily: "monospace", fontSize: 11, marginRight: 2, flexShrink: 0, marginTop: 2 }}>{i + 1}.</span>
        <span style={{ flex: 1 }}><ClickableSentence text={s.en || s} highlightTarget={word} /></span>
        <button onClick={() => speak(s.en || s)} title="Izgovori rečenicu" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, padding: "0 2px", opacity: 0.5, flexShrink: 0 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}>🔊</button>
      </div>
      {s.sr && <div style={{ fontSize: 12, color: "#888", fontStyle: "italic", paddingLeft: 20 }}>↳ {s.sr}</div>}
    </div>
  );

  const filteredWords = words.filter(w => {
    const mf = filter === "all" || w.status === filter;
    const ms = w.word?.toLowerCase().includes(search.toLowerCase()) || w.translation?.toLowerCase().includes(search.toLowerCase());
    return mf && ms;
  });

  const reviewWords = words.filter(w => w.status === "learning");
  const currentReview = reviewWords[reviewIndex];
  const statusLabel = s => ({ new: "Novo", learning: "Učim", known: "Znam" }[s] || s);
  const statusDot = s => ({ new: "#3b82f6", learning: "#f59e0b", known: "#22c55e" }[s] || "#999");
  const counts = { all: words.length, new: words.filter(w => w.status === "new").length, learning: words.filter(w => w.status === "learning").length, known: words.filter(w => w.status === "known").length };
  const inp = { width: "100%", background: "#12121a", border: "1px solid #2a2a3e", color: "#f0ebe3", padding: "11px 14px", borderRadius: 8, fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box" };

  if (loading) return <div style={{ minHeight: "100vh", background: "#0f0f13", display: "flex", alignItems: "center", justifyContent: "center", color: "#6366f1", fontFamily: "monospace", letterSpacing: 3 }}>UČITAVANJE BAZE...</div>;
  if (dbError) return <div style={{ minHeight: "100vh", background: "#0f0f13", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}><div style={{ background: "#1a0a0a", border: "1px solid #3a1a1a", borderRadius: 16, padding: 32, color: "#ef4444", fontFamily: "monospace", maxWidth: 400, textAlign: "center" }}><div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div><div>{dbError}</div></div></div>;

  return (
    <div style={{ minHeight: "100vh", background: "#0f0f13", fontFamily: "Georgia, serif", color: "#f0ebe3" }} onClick={() => setPopup(null)}>

      {popup && (
        <div style={{ position: "fixed", left: Math.min(popup.x - 80, window.innerWidth - 180), top: popup.y - 52, zIndex: 9999, background: "#1a1a2e", border: "1px solid #6366f1", borderRadius: 10, padding: "8px 12px", boxShadow: "0 8px 24px rgba(0,0,0,0.6)", display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
          <span style={{ fontSize: 13, color: "#a5b4fc", fontStyle: "italic", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>"{popup.word}"</span>
          <button onClick={() => handleQuickAdd(popup.word)} style={{ background: "#6366f1", border: "none", color: "#fff", padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>+ Dodaj</button>
          <button onClick={() => setPopup(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14, padding: "0 2px" }}>✕</button>
        </div>
      )}
      {quickAdding && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: "#6366f1", color: "#fff", padding: "12px 20px", borderRadius: 10, fontFamily: "monospace", fontSize: 13, boxShadow: "0 4px 20px rgba(99,102,241,0.4)" }}>⟳ Dodajem u rečnik...</div>
      )}
      {toast && <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: toast.color, color: "#fff", padding: "10px 20px", borderRadius: 8, fontFamily: "monospace", fontSize: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>{toast.msg}</div>}

      {/* HEADER */}
      <div style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)", borderBottom: "1px solid #2a2a3e", padding: "24px 24px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 4, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Vokabular Tracker</div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: "normal", letterSpacing: -0.5 }}>Moje Engleske Reči</h1>
            <div style={{ fontSize: 10, color: "#3a3a5e", fontFamily: "monospace", marginTop: 4 }}>● Supabase Cloud</div>
          </div>
          <button onClick={() => { setView("add"); setWordInput(""); setAiData(null); setNotes(""); }} style={{ background: "#6366f1", border: "none", color: "#fff", padding: "10px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: "monospace", letterSpacing: 1 }}>+ DODAJ</button>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {["all", "new", "learning", "known"].map(s => (
            <button key={s} onClick={() => setFilter(s)} style={{ background: filter === s ? "#6366f1" : "rgba(255,255,255,0.05)", border: "1px solid " + (filter === s ? "#6366f1" : "#2a2a3e"), color: filter === s ? "#fff" : "#888", padding: "6px 12px", borderRadius: 20, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>
              {s === "all" ? "Sve" : statusLabel(s)} ({counts[s]})
            </button>
          ))}
        </div>
      </div>

      {/* ADD VIEW */}
      {view === "add" && (
        <div style={{ padding: 24, maxWidth: 620 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <button onClick={() => setView("list")} style={{ background: "none", border: "1px solid #2a2a3e", color: "#888", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>← Nazad</button>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: "normal" }}>Nova Reč</h2>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Upiši reč ili frazu (srpski ili engleski)</label>
            <input value={wordInput} onChange={e => handleWordInput(e.target.value)} placeholder="npr. equity, take for granted, prinos, uzeti zdravo za gotovo..." autoFocus style={{ ...inp, fontSize: 18, fontStyle: "italic", padding: "14px 16px" }} />
          </div>
          {aiLoading && <div style={{ background: "#1a1a2e", borderRadius: 12, padding: 24, border: "1px solid #2a2a3e", marginBottom: 20, textAlign: "center", color: "#6366f1", fontFamily: "monospace", fontSize: 13, letterSpacing: 2 }}>TRAŽIM...</div>}
          {aiError && <div style={{ background: "#1a0a0a", border: "1px solid #3a1a1a", borderRadius: 12, padding: 16, marginBottom: 20, color: "#ef4444", fontSize: 13 }}>{aiError}</div>}
          {aiData && !aiLoading && (
            <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 24, border: "1px solid #6366f1", marginBottom: 20 }}>
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Prevod</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 22, color: "#f0ebe3" }}>{wordInput.trim().toLowerCase() === aiData.wordSr?.toLowerCase() ? aiData.wordEn : aiData.wordSr}</div>
                  <button onClick={() => speak(aiData.wordEn || wordInput)} title="Izgovor" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, padding: 4, opacity: 0.7 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.7}>🔊</button>
                </div>
                {aiData.ipa && <div style={{ fontSize: 13, color: "#6366f1", fontFamily: "monospace", marginTop: 3, letterSpacing: 1 }}>{aiData.ipa}</div>}
                {aiData.partOfSpeech && <div style={{ fontSize: 12, color: "#555", fontFamily: "monospace", marginTop: 4 }}>{aiData.partOfSpeech}</div>}
              </div>
              {aiData.synonyms?.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 8, textTransform: "uppercase" }}>Sinonimi</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {aiData.synonyms.map((syn, i) => <span key={i} style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "#a5b4fc", padding: "4px 12px", borderRadius: 20, fontSize: 13, fontStyle: "italic" }}>{syn}</span>)}
                  </div>
                </div>
              )}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", textTransform: "uppercase" }}>Primeri</div>
                  <button onClick={() => regenerateSentences(wordInput, (newS) => setAiData(prev => ({ ...prev, sentences: newS })), aiData.sentences)} disabled={regenLoading} style={{ background: regenLoading ? "#2a2a3e" : "rgba(99,102,241,0.15)", border: "1px solid #6366f1", color: regenLoading ? "#444" : "#a5b4fc", padding: "6px 14px", borderRadius: 8, cursor: regenLoading ? "default" : "pointer", fontSize: 12, fontFamily: "monospace", letterSpacing: 1 }}>
                    {regenLoading ? "..." : "↻ Generiši još primera"}
                  </button>
                </div>
                {aiData.sentences?.map((s, i) => <SentenceCard key={i} s={s} i={i} word={wordInput} />)}
              </div>
            </div>
          )}
          {aiData && !aiLoading && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Tvoje beleške (opcionalno)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="npr. viđeno u Bloomberg članku o ETF-ima..." rows={2} style={{ ...inp, resize: "vertical", fontFamily: "Georgia, serif" }} />
            </div>
          )}
          {aiData && !aiLoading && (
            <button onClick={addWord} disabled={saving} style={{ background: saving ? "#3a3a6e" : "#6366f1", border: "none", color: "#fff", padding: "14px", borderRadius: 10, cursor: saving ? "default" : "pointer", fontSize: 14, fontFamily: "monospace", letterSpacing: 1, width: "100%" }}>
              {saving ? "ČUVAM..." : "SAČUVAJ U BAZU →"}
            </button>
          )}
        </div>
      )}

      {/* DETAIL VIEW */}
      {view === "detail" && selected && (
        <div style={{ padding: 24, maxWidth: 620 }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
            <button onClick={() => { setView("list"); setEditingTranslation(false); }} style={{ background: "none", border: "1px solid #2a2a3e", color: "#888", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>← Nazad</button>
          </div>
          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 28, border: "1px solid #2a2a3e" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 32, fontWeight: "normal", fontStyle: "italic" }}>
                  {selected.word}
                  {selected.ipa && <span style={{ fontSize: 14, color: "#6366f1", fontStyle: "normal", fontFamily: "monospace", marginLeft: 12, letterSpacing: 1 }}>{selected.ipa}</span>}
                </h2>
                <button onClick={() => speak(selected.word)} title="Izgovor" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, padding: 4, opacity: 0.7 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.7}>🔊</button>
              </div>
              <span style={{ background: "rgba(99,102,241,0.15)", color: statusDot(selected.status), padding: "4px 12px", borderRadius: 20, fontSize: 11, fontFamily: "monospace" }}>{statusLabel(selected.status)}</span>
            </div>
            {selected.translation && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Prevod</div>
                {editingTranslation ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input value={editTranslationVal} onChange={e => setEditTranslationVal(e.target.value)} autoFocus style={{ flex: 1, background: "#12121a", border: "1px solid #6366f1", color: "#f0ebe3", padding: "8px 12px", borderRadius: 8, fontSize: 18, fontFamily: "Georgia, serif" }} />
                    <button onClick={async () => {
                      await db.updateTranslation(selected.id, editTranslationVal);
                      setWords(prev => prev.map(w => w.id === selected.id ? { ...w, wordSr: editTranslationVal, translation: editTranslationVal } : w));
                      setSelected(prev => ({ ...prev, wordSr: editTranslationVal, translation: editTranslationVal }));
                      setEditingTranslation(false); showToast("Prevod ažuriran ✓");
                    }} style={{ background: "#22c55e", border: "none", color: "#fff", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>✓</button>
                    <button onClick={() => setEditingTranslation(false)} style={{ background: "none", border: "1px solid #2a2a3e", color: "#888", padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ fontSize: 20, color: "#c9c0b4" }}>{selected.wordSr || selected.translation}</div>
                    <button onClick={() => { setEditTranslationVal(selected.wordSr || selected.translation); setEditingTranslation(true); }} style={{ background: "none", border: "1px solid #2a2a3e", color: "#555", padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>✎ edit</button>
                  </div>
                )}
                {selected.partOfSpeech && <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace", marginTop: 4 }}>{selected.partOfSpeech}</div>}
              </div>
            )}
            {selected.synonyms?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 8, textTransform: "uppercase" }}>Sinonimi</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selected.synonyms.map((syn, i) => <span key={i} style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "#a5b4fc", padding: "4px 12px", borderRadius: 20, fontSize: 13, fontStyle: "italic" }}>{syn}</span>)}
                </div>
              </div>
            )}
            {selected.sentences?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", textTransform: "uppercase" }}>Primeri</div>
                  <button onClick={() => regenerateSentences(selected.word, async (newS) => {
                    await db.updateSentences(selected.id, newS);
                    setWords(prev => prev.map(w => w.id === selected.id ? { ...w, sentences: newS } : w));
                    setSelected(prev => ({ ...prev, sentences: newS }));
                  }, selected.sentences)} disabled={regenLoading} style={{ background: regenLoading ? "#2a2a3e" : "rgba(99,102,241,0.15)", border: "1px solid #6366f1", color: regenLoading ? "#444" : "#a5b4fc", padding: "6px 14px", borderRadius: 8, cursor: regenLoading ? "default" : "pointer", fontSize: 12, fontFamily: "monospace", letterSpacing: 1 }}>
                    {regenLoading ? "..." : "↻ Generiši još primera"}
                  </button>
                </div>
                {selected.sentences.map((s, i) => <SentenceCard key={i} s={s} i={i} word={selected.word} />)}
              </div>
            )}
            {selected.notes && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 4, textTransform: "uppercase" }}>Beleške</div>
                <div style={{ fontSize: 13, color: "#888" }}>{selected.notes}</div>
              </div>
            )}
            <div style={{ fontSize: 11, color: "#444", marginBottom: 20, fontFamily: "monospace" }}>
              Dodano: {formatDate(selected.addedAt)} · Ponovljeno: {selected.reviewCount}x
              {selected.learnedAt && <span style={{ color: "#22c55e" }}> · Naučeno: {formatDate(selected.learnedAt)}</span>}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {["new", "learning", "known"].map(s => (
                <button key={s} onClick={() => { updateStatus(selected.id, s); setSelected(prev => ({ ...prev, status: s })); showToast("Status ažuriran"); }} style={{ background: selected.status === s ? statusDot(s) : "rgba(255,255,255,0.05)", border: "1px solid " + (selected.status === s ? statusDot(s) : "#2a2a3e"), color: selected.status === s ? "#fff" : "#888", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>{statusLabel(s)}</button>
              ))}
              <button onClick={() => deleteWord(selected.id)} style={{ background: "none", border: "1px solid #3a1a1a", color: "#ef4444", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace", marginLeft: "auto" }}>Obriši</button>
            </div>
          </div>
        </div>
      )}

      {/* REVIEW VIEW */}
      {view === "review" && (
        <div style={{ padding: 24, maxWidth: 540, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <button onClick={() => { setView("list"); setReviewIndex(0); setRevealed(false); }} style={{ background: "none", border: "1px solid #2a2a3e", color: "#888", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>← Nazad</button>
            <span style={{ fontSize: 13, color: "#888", fontFamily: "monospace" }}>{reviewIndex + 1} / {reviewWords.length}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { setReviewIndex(i => (i - 1 + reviewWords.length) % reviewWords.length); setRevealed(false); }} style={{ background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#888", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 16 }}>←</button>
              <button onClick={() => { setReviewIndex(i => (i + 1) % reviewWords.length); setRevealed(false); }} style={{ background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#888", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 16 }}>→</button>
            </div>
          </div>
          {reviewWords.length === 0 ? (
            <div style={{ textAlign: "center", color: "#888", padding: 60, fontSize: 18 }}>Nema reči označenih kao "Učim" 📖</div>
          ) : currentReview && (
            <div style={{ background: "#1a1a2e", borderRadius: 20, padding: 36, border: "2px solid #f59e0b", textAlign: "center", display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <div style={{ fontSize: 11, color: "#f59e0b", fontFamily: "monospace", letterSpacing: 2, marginBottom: 8 }}>KARTICA {reviewIndex + 1} OD {reviewWords.length}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <div style={{ fontSize: 38, fontStyle: "italic", fontWeight: 700 }}>{currentReview.word}</div>
                  <button onClick={() => speak(currentReview.word)} title="Izgovor" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 22, padding: 4, opacity: 0.7 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.7}>🔊</button>
                </div>
                {currentReview.wordSr && <div style={{ fontSize: 16, color: "#888", marginBottom: 4 }}>{currentReview.wordSr}</div>}
                {currentReview.ipa && <div style={{ fontSize: 13, color: "#6366f1", fontFamily: "monospace", letterSpacing: 1 }}>{currentReview.ipa}</div>}
                {currentReview.partOfSpeech && <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace" }}>{currentReview.partOfSpeech}</div>}
              </div>
              {!revealed ? (
                <button onClick={() => setRevealed(true)} style={{ background: "#6366f1", border: "none", color: "#fff", padding: "14px 32px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontFamily: "monospace", letterSpacing: 1 }}>POKAŽI PRIMER</button>
              ) : (
                <div>
                  {currentReview.sentences?.[0] && (
                    <div style={{ fontSize: 13, padding: "12px 16px", background: "rgba(99,102,241,0.08)", borderRadius: 8, marginBottom: 16, textAlign: "left" }}>
                      <div style={{ color: "#d0cbc4", fontStyle: "italic", lineHeight: 1.6, marginBottom: 4 }}>{highlightWord(currentReview.sentences[0].en || currentReview.sentences[0], currentReview.word)}</div>
                      {currentReview.sentences[0].sr && <div style={{ color: "#666", fontSize: 12, fontStyle: "italic" }}>↳ {currentReview.sentences[0].sr}</div>}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                    <button onClick={() => { updateStatus(currentReview.id, "new"); setReviewIndex(i => (i + 1) % reviewWords.length); setRevealed(false); }} style={{ background: "#3b82f6", border: "none", color: "#fff", padding: "10px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>← Vrati na Novo</button>
                    <button onClick={() => { updateStatus(currentReview.id, "known"); setReviewIndex(i => (i + 1) % reviewWords.length); setRevealed(false); }} style={{ background: "#22c55e", border: "none", color: "#fff", padding: "10px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>Znam ✓</button>
                  </div>
                </div>
              )}
              <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                {reviewWords.map((_, i) => (
                  <div key={i} onClick={() => { setReviewIndex(i); setRevealed(false); }} style={{ width: 8, height: 8, borderRadius: "50%", background: i === reviewIndex ? "#f59e0b" : "#2a2a3e", cursor: "pointer", transition: "background 0.2s" }} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* LIST VIEW */}
      {view === "list" && (
        <div style={{ padding: 24 }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pretraži..." style={{ flex: 1, background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#f0ebe3", padding: "10px 14px", borderRadius: 8, fontSize: 14, fontFamily: "Georgia, serif" }} />
            {filteredWords.length > 0 && (
              <button onClick={exportPDF} style={{ background: "rgba(99,102,241,0.15)", border: "1px solid #6366f1", color: "#a5b4fc", padding: "10px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap" }}>↓ PDF</button>
            )}
            {reviewWords.length > 0 && (
              <button onClick={() => { setView("review"); setReviewIndex(0); setRevealed(false); }} style={{ background: "#f59e0b", border: "none", color: "#fff", padding: "10px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                🔁 Ponavljaj ({reviewWords.length})
              </button>
            )}
          </div>
          {filteredWords.length === 0 ? (
            <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>📖</div>
              <div>Nema reči. Klikni + DODAJ!</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredWords.map(w => (
                <div key={w.id} onClick={() => { setSelected(w); setView("detail"); }}
                  style={{ background: w.status === "known" ? "linear-gradient(135deg, #14532d, #166534)" : w.status === "learning" ? "linear-gradient(135deg, #78350f, #92400e)" : "linear-gradient(135deg, #1e3a5f, #1e3a8a)", border: "2px solid " + (w.status === "known" ? "#4ade80" : w.status === "learning" ? "#fbbf24" : "#60a5fa"), borderRadius: 12, padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: w.status === "known" ? "0 0 12px rgba(74,222,128,0.2)" : w.status === "learning" ? "0 0 12px rgba(251,191,36,0.2)" : "0 0 12px rgba(96,165,250,0.2)" }}
                  onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
                  onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
                  <div>
                    <div style={{ fontSize: 17, fontStyle: "italic", fontWeight: 700, color: "#fff", marginBottom: 2 }}>{w.word}</div>
                    {w.translation && <div style={{ fontSize: 12, color: "#fff" }}>{w.translation}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 5 }}>
                    {[["★","new","#3b82f6"],["?","learning","#f59e0b"],["✓","known","#22c55e"]].map(([label, s, color]) => (
                      <button key={s} onClick={e => { e.stopPropagation(); updateStatus(w.id, s); }} style={{ background: w.status === s ? color : "transparent", border: "1px solid " + (w.status === s ? color : "rgba(255,255,255,0.2)"), color: w.status === s ? "#fff" : "rgba(255,255,255,0.25)", width: 24, height: 24, borderRadius: "50%", cursor: "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}>{label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`* { outline: none; } input, textarea { transition: border-color 0.2s; } input:focus, textarea:focus { border-color: #6366f1 !important; } input::placeholder, textarea::placeholder { color: #444; }`}</style>
    </div>
  );
}

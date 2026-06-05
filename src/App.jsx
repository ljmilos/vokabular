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
  async insert(word) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vocabulary`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ word: word.word, translation: word.translation, part_of_speech: word.partOfSpeech, sentences: word.sentences, notes: word.notes, status: "new", review_count: 0 })
    });
    const data = await res.json();
    return data[0];
  },
  async updateReview(id, status, reviewCount) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status, review_count: reviewCount + 1 })
    });
  },
  async updateSentences(id, sentences) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sentences })
    });
  },
  async delete(id) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "DELETE",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
    });
  }
};

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("sr-RS", { day: "2-digit", month: "short", year: "numeric" });
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

function normalize(row) {
  return { id: row.id, word: row.word, translation: row.translation, partOfSpeech: row.part_of_speech, sentences: row.sentences || [], notes: row.notes || "", status: row.status || "new", addedAt: row.added_at, reviewCount: row.review_count || 0 };
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
  const debounceRef = useRef(null);

  useEffect(() => {
    db.getAll().then(rows => {
      if (Array.isArray(rows)) setWords(rows.map(normalize));
      else setDbError("Greška pri učitavanju. Provjeri Supabase RLS podešavanja.");
      setLoading(false);
    }).catch(() => { setDbError("Ne mogu se spojiti na bazu."); setLoading(false); });
  }, []);

  const showToast = (msg, color = "#22c55e") => { setToast({ msg, color }); setTimeout(() => setToast(null), 2500); };

  const lookupWord = async (word) => {
    if (!word.trim() || word.trim().length < 2) { setAiData(null); return; }
    // Cache check — word already in DB, no API call needed
    const cached = words.find(w => w.word.toLowerCase() === word.trim().toLowerCase());
    if (cached) {
      setAiData({ translation: cached.translation, partOfSpeech: cached.partOfSpeech, sentences: cached.sentences });
      return;
    }
    setAiLoading(true); setAiError(null); setAiData(null);
    try {
      const res = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 400, messages: [{ role: "user", content: `Serbian B1 learner. Word: "${word.trim()}". Reply ONLY valid JSON, no markdown:\n{"translation":"sr prevod","partOfSpeech":"type","sentences":[{"en":"sentence 1","sr":"prevod 1"},{"en":"sentence 2","sr":"prevod 2"},{"en":"sentence 3","sr":"prevod 3"}]}` }] })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      setAiData(JSON.parse(text.replace(/```json|```/g, "").trim()));
    } catch (e) { setAiError("Greška pri učitavanju. Pokušaj ponovo."); }
    setAiLoading(false);
  };

  const regenerateSentences = async (word, setter, currentSentences) => {
    setRegenLoading(true);
    try {
      const res = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 400, messages: [{ role: "user", content: `3 NEW sentences for "${word}", NOT these:\n${currentSentences?.map(s => "- " + (s.en || s)).join("\n")}\nReply ONLY JSON array:\n[{"en":"...","sr":"..."},{"en":"...","sr":"..."},{"en":"...","sr":"..."}]` }] })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      setter(JSON.parse(text.replace(/```json|```/g, "").trim()));
      showToast("Nove recenice generisane");
    } catch (e) { showToast("Greska, pokusaj ponovo", "#ef4444"); }
    setRegenLoading(false);
  };

  const handleWordInput = (val) => {
    setWordInput(val); setAiData(null); setAiError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length >= 2) debounceRef.current = setTimeout(() => lookupWord(val), 700);
  };

  const addWord = async () => {
    if (!wordInput.trim() || !aiData) return;
    setSaving(true);
    try {
      const row = await db.insert({ word: wordInput.trim(), translation: aiData.translation, partOfSpeech: aiData.partOfSpeech, sentences: aiData.sentences, notes: notes.trim() });
      if (row) setWords(prev => [normalize(row), ...prev]);
      setWordInput(""); setAiData(null); setNotes(""); setView("list");
      showToast("Rec sacuvana u bazu");
    } catch (e) { showToast("Greska pri cuvanju", "#ef4444"); }
    setSaving(false);
  };

  const updateStatus = async (id, status) => {
    const w = words.find(x => x.id === id);
    await db.updateReview(id, status, w?.reviewCount || 0);
    setWords(prev => prev.map(x => x.id === id ? { ...x, status, reviewCount: (x.reviewCount || 0) + 1 } : x));
  };

  const deleteWord = async (id) => {
    await db.delete(id); setWords(prev => prev.filter(x => x.id !== id)); setView("list");
    showToast("Obrisano", "#ef4444");
  };

  const filteredWords = words.filter(w => {
    const mf = filter === "all" || w.status === filter;
    const ms = w.word?.toLowerCase().includes(search.toLowerCase()) || w.translation?.toLowerCase().includes(search.toLowerCase());
    return mf && ms;
  });

  const reviewWords = words.filter(w => w.status !== "known");
  const currentReview = reviewWords[reviewIndex];
  const statusLabel = s => ({ new: "Novo", learning: "Ucim", known: "Znam" }[s] || s);
  const statusDot = s => ({ new: "#3b82f6", learning: "#f59e0b", known: "#22c55e" }[s] || "#999");
  const counts = { all: words.length, new: words.filter(w => w.status === "new").length, learning: words.filter(w => w.status === "learning").length, known: words.filter(w => w.status === "known").length };
  const inp = { width: "100%", background: "#12121a", border: "1px solid #2a2a3e", color: "#f0ebe3", padding: "11px 14px", borderRadius: 8, fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box" };

  const SentenceCard = ({ s, i, word }) => (
    <div style={{ background: "rgba(99,102,241,0.07)", borderLeft: "2px solid #6366f1", padding: "10px 14px", borderRadius: "0 8px 8px 0", marginBottom: 10 }}>
      <div style={{ fontSize: 14, lineHeight: 1.65, color: "#d0cbc4", marginBottom: 4 }}>
        <span style={{ color: "#6366f1", fontFamily: "monospace", fontSize: 11, marginRight: 8 }}>{i + 1}.</span>
        {highlightWord(s.en || s, word)}
      </div>
      {s.sr && <div style={{ fontSize: 12, color: "#888", fontStyle: "italic", paddingLeft: 20 }}>&#8627; {s.sr}</div>}
    </div>
  );

  if (loading) return <div style={{ minHeight: "100vh", background: "#0f0f13", display: "flex", alignItems: "center", justifyContent: "center", color: "#6366f1", fontFamily: "monospace", letterSpacing: 3 }}>UCITAVANJE BAZE...</div>;
  if (dbError) return <div style={{ minHeight: "100vh", background: "#0f0f13", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}><div style={{ background: "#1a0a0a", border: "1px solid #3a1a1a", borderRadius: 16, padding: 32, color: "#ef4444", fontFamily: "monospace", maxWidth: 400, textAlign: "center" }}><div style={{ fontSize: 32, marginBottom: 16 }}>!</div><div>{dbError}</div></div></div>;

  return (
    <div style={{ minHeight: "100vh", background: "#0f0f13", fontFamily: "Georgia, serif", color: "#f0ebe3" }}>
      {toast && <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: toast.color, color: "#fff", padding: "10px 20px", borderRadius: 8, fontFamily: "monospace", fontSize: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>{toast.msg}</div>}

      {/* HEADER */}
      <div style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)", borderBottom: "1px solid #2a2a3e", padding: "24px 24px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 4, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Vokabular Tracker</div>
            <h1 style={{ margin: 0, fontSize: 26, fontWeight: "normal", letterSpacing: -0.5 }}>Moje Engleske Reci</h1>
            <div style={{ fontSize: 10, color: "#3a3a5e", fontFamily: "monospace", marginTop: 4 }}>&#9679; Supabase Cloud</div>
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
            <button onClick={() => setView("list")} style={{ background: "none", border: "1px solid #2a2a3e", color: "#888", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>&#8592; Nazad</button>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: "normal" }}>Nova Rec</h2>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Upisi englesku rec ili frazu</label>
            <input value={wordInput} onChange={e => handleWordInput(e.target.value)} placeholder="npr. fiduciary, take for granted, equity..." autoFocus style={{ ...inp, fontSize: 18, fontStyle: "italic", padding: "14px 16px" }} />
          </div>
          {aiLoading && <div style={{ background: "#1a1a2e", borderRadius: 12, padding: 24, border: "1px solid #2a2a3e", marginBottom: 20, textAlign: "center", color: "#6366f1", fontFamily: "monospace", fontSize: 13, letterSpacing: 2 }}>TRAZIM...</div>}
          {aiError && <div style={{ background: "#1a0a0a", border: "1px solid #3a1a1a", borderRadius: 12, padding: 16, marginBottom: 20, color: "#ef4444", fontSize: 13 }}>{aiError}</div>}
          {aiData && !aiLoading && (
            <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 24, border: "1px solid #6366f1", marginBottom: 20 }}>
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Prevod</div>
                <div style={{ fontSize: 22, color: "#f0ebe3" }}>{aiData.translation}</div>
                {aiData.partOfSpeech && <div style={{ fontSize: 12, color: "#555", fontFamily: "monospace", marginTop: 4 }}>{aiData.partOfSpeech}</div>}
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", textTransform: "uppercase" }}>3 Konteksne Recenice</div>
                  <button onClick={() => regenerateSentences(wordInput, (newS) => setAiData(prev => ({ ...prev, sentences: newS })), aiData.sentences)} disabled={regenLoading} style={{ background: "none", border: "1px solid #2a2a3e", color: regenLoading ? "#444" : "#888", padding: "4px 10px", borderRadius: 6, cursor: regenLoading ? "default" : "pointer", fontSize: 11, fontFamily: "monospace" }}>
                    {regenLoading ? "..." : "&#8635; NOVE"}
                  </button>
                </div>
                {aiData.sentences?.map((s, i) => <SentenceCard key={i} s={s} i={i} word={wordInput} />)}
              </div>
            </div>
          )}
          {aiData && !aiLoading && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Tvoje belezke (opcionalno)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="npr. vidjeno u Bloomberg clanku o ETF-ima, cesto uz 'duty'..." rows={2} style={{ ...inp, resize: "vertical", fontFamily: "Georgia, serif" }} />
            </div>
          )}
          {aiData && !aiLoading && (
            <button onClick={addWord} disabled={saving} style={{ background: saving ? "#3a3a6e" : "#6366f1", border: "none", color: "#fff", padding: "14px", borderRadius: 10, cursor: saving ? "default" : "pointer", fontSize: 14, fontFamily: "monospace", letterSpacing: 1, width: "100%" }}>
              {saving ? "CUVAM..." : "SACUVAJ U BAZU"}
            </button>
          )}
        </div>
      )}

      {/* DETAIL VIEW */}
      {view === "detail" && selected && (
        <div style={{ padding: 24, maxWidth: 620 }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
            <button onClick={() => setView("list")} style={{ background: "none", border: "1px solid #2a2a3e", color: "#888", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>&#8592; Nazad</button>
          </div>
          <div style={{ background: "#1a1a2e", borderRadius: 16, padding: 28, border: "1px solid #2a2a3e" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 32, fontWeight: "normal", fontStyle: "italic" }}>{selected.word}</h2>
              <span style={{ background: "rgba(99,102,241,0.15)", color: statusDot(selected.status), padding: "4px 12px", borderRadius: 20, fontSize: 11, fontFamily: "monospace" }}>{statusLabel(selected.status)}</span>
            </div>
            {selected.translation && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 4, textTransform: "uppercase" }}>Prevod</div>
                <div style={{ fontSize: 20, color: "#c9c0b4" }}>{selected.translation}</div>
                {selected.partOfSpeech && <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace" }}>{selected.partOfSpeech}</div>}
              </div>
            )}
            {selected.sentences?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", textTransform: "uppercase" }}>Konteksne Recenice</div>
                  <button onClick={() => regenerateSentences(selected.word, async (newS) => {
                    await db.updateSentences(selected.id, newS);
                    setWords(prev => prev.map(w => w.id === selected.id ? { ...w, sentences: newS } : w));
                    setSelected(prev => ({ ...prev, sentences: newS }));
                  }, selected.sentences)} disabled={regenLoading} style={{ background: "none", border: "1px solid #2a2a3e", color: regenLoading ? "#444" : "#888", padding: "4px 10px", borderRadius: 6, cursor: regenLoading ? "default" : "pointer", fontSize: 11, fontFamily: "monospace" }}>
                    {regenLoading ? "..." : "&#8635; NOVE"}
                  </button>
                </div>
                {selected.sentences.map((s, i) => <SentenceCard key={i} s={s} i={i} word={selected.word} />)}
              </div>
            )}
            {selected.notes && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 4, textTransform: "uppercase" }}>Belezke</div>
                <div style={{ fontSize: 13, color: "#888" }}>{selected.notes}</div>
              </div>
            )}
            <div style={{ fontSize: 11, color: "#444", marginBottom: 20, fontFamily: "monospace" }}>Dodano: {formatDate(selected.addedAt)} &#183; Ponovljeno: {selected.reviewCount}x</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {["new", "learning", "known"].map(s => (
                <button key={s} onClick={() => { updateStatus(selected.id, s); setSelected(prev => ({ ...prev, status: s })); showToast("Status azuriran"); }} style={{ background: selected.status === s ? statusDot(s) : "rgba(255,255,255,0.05)", border: "1px solid " + (selected.status === s ? statusDot(s) : "#2a2a3e"), color: selected.status === s ? "#fff" : "#888", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>{statusLabel(s)}</button>
              ))}
              <button onClick={() => deleteWord(selected.id)} style={{ background: "none", border: "1px solid #3a1a1a", color: "#ef4444", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace", marginLeft: "auto" }}>Obrisi</button>
            </div>
          </div>
        </div>
      )}

      {/* REVIEW VIEW */}
      {view === "review" && (
        <div style={{ padding: 24, maxWidth: 500, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <button onClick={() => { setView("list"); setReviewIndex(0); setRevealed(false); }} style={{ background: "none", border: "1px solid #2a2a3e", color: "#888", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>&#8592; Nazad</button>
            <span style={{ fontSize: 12, color: "#888", fontFamily: "monospace" }}>{reviewIndex + 1} / {reviewWords.length}</span>
          </div>
          {reviewWords.length === 0 ? (
            <div style={{ textAlign: "center", color: "#888", padding: 60, fontSize: 18 }}>Sve reci su naucene!</div>
          ) : currentReview && (
            <div style={{ background: "#1a1a2e", borderRadius: 20, padding: 36, border: "1px solid #2a2a3e", textAlign: "center", display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <div style={{ fontSize: 38, fontStyle: "italic", marginBottom: 8 }}>{currentReview.word}</div>
                {currentReview.partOfSpeech && <div style={{ fontSize: 11, color: "#555", fontFamily: "monospace" }}>{currentReview.partOfSpeech}</div>}
              </div>
              {!revealed ? (
                <button onClick={() => setRevealed(true)} style={{ background: "#6366f1", border: "none", color: "#fff", padding: "14px 32px", borderRadius: 10, cursor: "pointer", fontSize: 14, fontFamily: "monospace", letterSpacing: 1 }}>POKAZI ODGOVOR</button>
              ) : (
                <div>
                  <div style={{ fontSize: 22, color: "#c9c0b4", marginBottom: 14 }}>{currentReview.translation}</div>
                  {currentReview.sentences?.[0] && (
                    <div style={{ fontSize: 13, padding: "12px 16px", background: "rgba(99,102,241,0.08)", borderRadius: 8, marginBottom: 16, textAlign: "left" }}>
                      <div style={{ color: "#888", fontStyle: "italic", lineHeight: 1.6, marginBottom: 4 }}>{highlightWord(currentReview.sentences[0].en || currentReview.sentences[0], currentReview.word)}</div>
                      {currentReview.sentences[0].sr && <div style={{ color: "#666", fontSize: 12, fontStyle: "italic" }}>&#8627; {currentReview.sentences[0].sr}</div>}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                    <button onClick={() => { updateStatus(currentReview.id, "learning"); setReviewIndex(i => (i + 1) % reviewWords.length); setRevealed(false); }} style={{ background: "#f59e0b", border: "none", color: "#fff", padding: "10px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: "monospace" }}>Jos ucim</button>
                    <button onClick={() => { updateStatus(currentReview.id, "known"); setReviewIndex(i => (i + 1) % reviewWords.length); setRevealed(false); }} style={{ background: "#22c55e", border: "none", color: "#fff", padding: "10px 20px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: "monospace" }}>Znam</button>
                  </div>
                  <button onClick={() => { setReviewIndex(i => (i + 1) % reviewWords.length); setRevealed(false); }} style={{ background: "none", border: "none", color: "#444", padding: "8px", cursor: "pointer", fontSize: 12, fontFamily: "monospace", marginTop: 8 }}>preskoci</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* LIST VIEW */}
      {view === "list" && (
        <div style={{ padding: 24 }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pretrazi..." style={{ flex: 1, background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#f0ebe3", padding: "10px 14px", borderRadius: 8, fontSize: 14, fontFamily: "Georgia, serif" }} />
            {reviewWords.length > 0 && (
              <button onClick={() => { setView("review"); setReviewIndex(0); setRevealed(false); }} style={{ background: "#f59e0b", border: "none", color: "#fff", padding: "10px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                Ponavljaj ({reviewWords.length})
              </button>
            )}
          </div>
          {filteredWords.length === 0 ? (
            <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>&#128214;</div>
              <div>Nema reci. Klikni + DODAJ!</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filteredWords.map(w => (
                <div key={w.id} onClick={() => { setSelected(w); setView("detail"); }} style={{ background: "#1a1a2e", border: "1px solid #2a2a3e", borderRadius: 12, padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#6366f1"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "#2a2a3e"}>
                  <div>
                    <div style={{ fontSize: 17, fontStyle: "italic", marginBottom: 2 }}>{w.word}</div>
                    {w.translation && <div style={{ fontSize: 12, color: "#888" }}>{w.translation}</div>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusDot(w.status), display: "inline-block" }} />
                    <span style={{ fontSize: 11, color: "#555", fontFamily: "monospace" }}>{formatDate(w.addedAt)}</span>
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

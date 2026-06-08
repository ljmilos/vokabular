import { useState, useEffect, useRef } from "react";

const SUPABASE_URL = "https://evajlksybjhnqvrykimf.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2YWpsa3N5YmpobnF2cnlraW1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NzY4NjgsImV4cCI6MjA5NjI1Mjg2OH0.WAdG0kvqXNPtgivfZwPxFDOUnmnEk95rYokK0gSRXa4";

const supabaseAuth = {
  async signUp(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    return res.json();
  },
  async signIn(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    return res.json();
  },
  async signOut(token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    });
  },
  async getUser(token) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    });
    return res.json();
  }
};

const db = {
  async getAll(token) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?order=added_at.desc`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    });
    return res.json();
  },
  async insert(token, w) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vocabulary`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ word: w.word, word_sr: w.wordSr, translation: w.translation, ipa: w.ipa, part_of_speech: w.partOfSpeech, synonyms: w.synonyms, sentences: w.sentences, notes: w.notes, status: "new", review_count: 0 })
    });
    const data = await res.json();
    return data[0];
  },
  async updateStatus(token, id, status, reviewCount, learnedAt) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status, review_count: reviewCount + 1, learned_at: learnedAt || null })
    });
  },
  async updateTranslation(token, id, translation) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ translation, word_sr: translation })
    });
  },
  async delete(token, id) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "DELETE",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    });
  }
};

function normalize(r) {
  return {
    id: r.id,
    word: r.word || "",
    wordSr: r.word_sr || r.translation || "",
    translation: r.translation || r.word_sr || "",
    ipa: r.ipa || "",
    partOfSpeech: r.part_of_speech || "",
    synonyms: r.synonyms || [],
    sentences: r.sentences || [],
    notes: r.notes || "",
    status: r.status || "new",
    addedAt: r.added_at || new Date().toISOString(),
    reviewCount: r.review_count || 0,
    learnedAt: r.learned_at || null
  };
}



function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("sr-RS", { day: "2-digit", month: "short", year: "numeric" });
}

function highlightWord(sentence, word) {
  if (!word || !sentence) return sentence;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = sentence.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((p, i) =>
    p.toLowerCase() === word.toLowerCase()
      ? <mark key={i} style={{ background: "rgba(99,102,241,0.35)", color: "#a5b4fc", borderRadius: 3, padding: "0 2px" }}>{p}</mark>
      : p
  );
}

const statusColors = { new: "#3b82f6", learning: "#e11d48", known: "#22c55e" };
const statusBg = {
  new: "linear-gradient(135deg, #1e3a5f, #1e3a8a)",
  learning: "linear-gradient(135deg, #4a0d1f, #6b1530)",
  known: "linear-gradient(135deg, #14532d, #166534)"
};
const statusBorder = { new: "#3b82f6", learning: "#e11d48", known: "#22c55e" };

export default function VocabTracker() {
  const [words, setWords] = useState([]);
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [authView, setAuthView] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [view, setView] = useState("list");
  const [layoutView, setLayoutView] = useState("list"); // "list" | "board"
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 600);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  // Add view state
  const [wordInput, setWordInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiData, setAiData] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState("");
  const [customSentence, setCustomSentence] = useState("");

  // Detail view state
  const [editingTranslation, setEditingTranslation] = useState(false);
  const [editTranslationVal, setEditTranslationVal] = useState("");

  // Combine mode
  const [combineMode, setCombineMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [combineLoading, setCombineLoading] = useState(false);
  const [combineResult, setCombineResult] = useState(null);

  // Popup
  const [popup, setPopup] = useState(null);
  const popupRef = useRef(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2200); };

  // Track screen width for responsive board
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Auth init
  useEffect(() => {
    const init = async () => {
      const t = localStorage.getItem("sb_token");
      if (t) {
        const u = await supabaseAuth.getUser(t);
        if (u?.id) {
          setToken(t); setUser(u);
          const rows = await db.getAll(t);
          if (Array.isArray(rows)) setWords(rows.map(normalize));
        } else {
          localStorage.removeItem("sb_token");
        }
      }
      setLoading(false);
    };
    init();
  }, []);

  const filteredWords = words.filter(w => {
    if (filter !== "all" && w.status !== filter) return false;
    if (search && !w.word.toLowerCase().includes(search.toLowerCase()) && !w.translation?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const updateStatus = async (id, status) => {
    const w = words.find(x => x.id === id);
    const learnedAt = status === "known" ? new Date().toISOString() : null;
    const reviewCount = (w?.reviewCount || 0);
    setWords(prev => prev.map(x => x.id === id ? { ...x, status, reviewCount: reviewCount + 1, learnedAt } : x));
    if (selected?.id === id) setSelected(prev => ({ ...prev, status, learnedAt }));
    try { await db.updateStatus(token, id, status, reviewCount, learnedAt); } catch(e) {}
  };

  const deleteWord = async (id) => {
    setWords(prev => prev.filter(x => x.id !== id));
    if (selected?.id === id) { setSelected(null); setView("list"); }
    try { await db.delete(token, id); } catch(e) {}
    showToast("Obrisano");
  };

  const lookupWord = async () => {
    if (!wordInput.trim()) return;
    setAiLoading(true); setAiError(null); setAiData(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `Za englesku reč ili frazu "${wordInput.trim()}" daj JSON objekat (SAMO JSON, bez markdown, bez objašnjenja):
{"wordEn":"ENGLISH word","wordSr":"SRPSKA rec","partOfSpeech":"type","ipa":"/IPA pronunciation/","synonyms":["syn1","syn2","syn3"],"sentences":["example sentence 1 using the word","example sentence 2 using the word","example sentence 3 using the word"]}`
          }]
        })
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setAiData(parsed);
    } catch (e) {
      setAiError("Greška pri pretrazi. Pokušaj ponovo.");
    }
    setAiLoading(false);
  };

  const saveWord = async () => {
    if (!aiData) return;
    setSaving(true);
    const w = {
      word: aiData.wordEn, wordSr: aiData.wordSr, translation: aiData.wordSr,
      ipa: aiData.ipa || "", partOfSpeech: aiData.partOfSpeech || "",
      synonyms: aiData.synonyms || [],
      sentences: customSentence.trim() ? [...(aiData.sentences || []), customSentence.trim()] : (aiData.sentences || []),
      notes
    };
    try {
      const row = await db.insert(token, w);
      if (row) setWords(prev => [normalize(row), ...prev]);
    } catch(e) {}
    setWordInput(""); setAiData(null); setNotes(""); setCustomSentence(""); setSaving(false);
    setView("list");
    showToast("Reč sačuvana ✓");
  };

  const generateCombined = async () => {
    if (selectedIds.length < 2) return;
    setCombineLoading(true); setCombineResult(null);
    const chosen = words.filter(w => selectedIds.includes(w.id));
    const wordList = chosen.map(w => w.word).join(", ");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `Napiši 3 zanimljive engleske rečenice koje prirodno koriste SVE ove reči zajedno: ${wordList}. SAMO JSON: {"sentences":["s1","s2","s3"]}`
          }]
        })
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setCombineResult({ words: chosen, sentences: parsed.sentences });
      setCombineMode(false); setSelectedIds([]);
      setView("combine");
    } catch (e) {
      showToast("Greška pri generisanju");
    }
    setCombineLoading(false);
  };

  const handleTextSelect = (e) => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.length < 2 || text.length > 40) { setPopup(null); return; }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    setPopup({ text, x: rect.left + rect.width / 2 - 80, y: rect.bottom + window.scrollY + 8 });
  };

  const handlePopupLookup = () => {
    if (!popup) return;
    setWordInput(popup.text);
    setPopup(null);
    setView("add");
    setAiData(null);
    setTimeout(() => lookupWordWith(popup.text), 100);
  };

  const lookupWordWith = async (w) => {
    setAiLoading(true); setAiError(null); setAiData(null);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `Za englesku reč ili frazu "${w}" daj JSON objekat (SAMO JSON):
{"wordEn":"ENGLISH word","wordSr":"SRPSKA rec","partOfSpeech":"type","ipa":"/IPA pronunciation/","synonyms":["syn1","syn2","syn3"],"sentences":["example sentence 1","example sentence 2","example sentence 3"]}`
          }]
        })
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setAiData(parsed);
    } catch (e) { setAiError("Greška."); }
    setAiLoading(false);
  };

  const exportPDF = () => showToast("PDF export — uskoro!");

  // ── RENDER ──

  const handleAuth = async () => {
    if (!authEmail || !authPassword) { setAuthError("Upiši email i lozinku."); return; }
    setAuthLoading(true); setAuthError(null);
    try {
      if (authView === "register") {
        const data = await supabaseAuth.signUp(authEmail, authPassword);
        if (data.error) { setAuthError(data.error.message || "Greška pri registraciji."); }
        else { setEmailConfirmed(true); }
      } else {
        const data = await supabaseAuth.signIn(authEmail, authPassword);
        if (data.error) { setAuthError(data.error.message || "Pogrešan email ili lozinka."); }
        else if (data.access_token) {
          const t = data.access_token;
          localStorage.setItem("sb_token", t);
          setToken(t);
          const u = data.user || await supabaseAuth.getUser(t);
          setUser(u);
          const rows = await db.getAll(t);
          if (Array.isArray(rows)) setWords(rows.map(normalize));
        }
      }
    } catch(e) { setAuthError("Greška pri povezivanju. Pokušaj ponovo."); }
    setAuthLoading(false);
  };

  if (loading) return <div style={{ minHeight: "100vh", background: "#0f0f13", display: "flex", alignItems: "center", justifyContent: "center", color: "#6366f1", fontFamily: "monospace", letterSpacing: 3 }}>UČITAVANJE BAZE...</div>;

  if (emailConfirmed) return (
    <div style={{ minHeight: "100vh", background: "#0f0f13", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#1a1a2e", border: "1px solid #22c55e44", borderRadius: 20, padding: 48, width: "100%", maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>✅</div>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "#6366f1", marginBottom: 12, textTransform: "uppercase" }}>Vokabular Tracker</div>
        <h2 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: "normal", color: "#f0ebe3" }}>Email uspešno potvrđen!</h2>
        <p style={{ color: "#888", fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>Tvoj nalog je aktiviran. Možeš se sada prijaviti.</p>
        <button onClick={() => setEmailConfirmed(false)} style={{ background: "#6366f1", border: "none", color: "#fff", padding: "14px 40px", borderRadius: 10, cursor: "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 1 }}>PRIJAVI SE →</button>
      </div>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight: "100vh", background: "#0f0f13", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#1a1a2e", border: "1px solid #2a2a3e", borderRadius: 20, padding: 40, width: "100%", maxWidth: 400 }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "#6366f1", marginBottom: 8, textTransform: "uppercase" }}>Vokabular Tracker</div>
        <h1 style={{ margin: "0 0 32px", fontSize: 24, fontWeight: "normal" }}>{authView === "login" ? "Prijava" : "Registracija"}</h1>
        {authError && <div style={{ background: "#1a0a0a", border: "1px solid #3a1a1a", borderRadius: 8, padding: "10px 14px", color: "#ef4444", fontSize: 13, marginBottom: 16 }}>{authError}</div>}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Email</label>
          <input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAuth()} placeholder="vas@email.com"
            style={{ width: "100%", background: "#12121a", border: "1px solid #2a2a3e", color: "#f0ebe3", padding: "11px 14px", borderRadius: 8, fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Lozinka</label>
          <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAuth()} placeholder="••••••••"
            style={{ width: "100%", background: "#12121a", border: "1px solid #2a2a3e", color: "#f0ebe3", padding: "11px 14px", borderRadius: 8, fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box" }} />
        </div>
        <button onClick={handleAuth} disabled={authLoading}
          style={{ width: "100%", background: authLoading ? "#3a3a6e" : "#6366f1", border: "none", color: "#fff", padding: "14px", borderRadius: 10, cursor: authLoading ? "default" : "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 1, marginBottom: 16 }}>
          {authLoading ? "ČEKAJ..." : authView === "login" ? "PRIJAVI SE" : "REGISTRUJ SE"}
        </button>
        <div style={{ textAlign: "center", fontSize: 13, color: "#888" }}>
          {authView === "login" ? "Nemaš nalog?" : "Već imaš nalog?"}
          <button onClick={() => { setAuthView(authView === "login" ? "register" : "login"); setAuthError(null); }}
            style={{ background: "none", border: "none", color: "#6366f1", cursor: "pointer", fontSize: 13, marginLeft: 6, textDecoration: "underline" }}>
            {authView === "login" ? "Registruj se" : "Prijavi se"}
          </button>
        </div>
      </div>
    </div>
  );

  const counts = { all: words.length, new: words.filter(w => w.status === "new").length, learning: words.filter(w => w.status === "learning").length, known: words.filter(w => w.status === "known").length };

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a12", color: "#f0ebe3", fontFamily: "Georgia, serif", position: "relative" }}
      onMouseUp={handleTextSelect}>

      {/* HEADER */}
      <div style={{ background: "#0f1729", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "14px 20px", display: "flex", justifyContent: "center" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 4, color: "#6366f1", textTransform: "uppercase", marginBottom: 2 }}>Vokabular Tracker</div>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: "normal" }}>Moje Engleske Reči</h1>
              <div style={{ fontSize: 10, color: "#3a3a5e", fontFamily: "monospace", marginTop: 4 }}>● Supabase Cloud — {user?.email}</div>
            </div>
            <button onClick={async () => { await supabaseAuth.signOut(token); localStorage.removeItem("sb_token"); setToken(null); setUser(null); setWords([]); }}
              style={{ background: "none", border: "1px solid #2a2a3e", color: "#555", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>odjavi se</button>
          </div>
          {/* Filter tabs */}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {[["all","Sve"], ["new","Novo"], ["learning","Učim"], ["known","Znam"]].map(([val, label]) => (
              <button key={val} onClick={() => setFilter(val)}
                style={{ background: filter === val ? "#6366f1" : "rgba(255,255,255,0.05)", border: "1px solid " + (filter === val ? "#6366f1" : "rgba(255,255,255,0.1)"), color: filter === val ? "#fff" : "rgba(255,255,255,0.6)", padding: "5px 14px", borderRadius: 20, cursor: "pointer", fontSize: 13, fontFamily: "monospace" }}>
                {label} ({counts[val]})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 16px 100px", width: "100%", boxSizing: "border-box" }}>

        {/* LIST VIEW */}
        {view === "list" && (
          <div>
            {/* Search + actions bar */}
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pretraži..."
                style={{ flex: 1, minWidth: 160, background: "#12121a", border: "1px solid #2a2a3e", color: "#f0ebe3", padding: "10px 14px", borderRadius: 10, fontSize: 14, fontFamily: "Georgia, serif" }} />
              <button onClick={exportPDF}
                style={{ background: "transparent", border: "1px solid #3b82f6", color: "#60a5fa", padding: "10px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                ↓ PDF
              </button>
              <button onClick={() => { setCombineMode(!combineMode); setSelectedIds([]); }}
                style={{ background: combineMode ? "#6366f1" : "transparent", border: "1px solid " + (combineMode ? "#6366f1" : "#6366f1"), color: combineMode ? "#fff" : "#818cf8", padding: "10px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                ⊕ Kombiniraj
              </button>
              <button onClick={() => { setWords(prev => prev.filter(w => w.status !== "known")); showToast("Naučene reči obrisane"); }}
                style={{ background: "transparent", border: "1px solid #22c55e44", color: "#4ade80", padding: "10px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                Ponavlja&#x6a; ({counts.learning})
              </button>
              {/* View switcher */}
              <div style={{ display: "flex", background: "#12121a", border: "1px solid #2a2a3e", borderRadius: 10, overflow: "hidden" }}>
                <button onClick={() => setLayoutView("list")} title="Lista"
                  style={{ background: layoutView === "list" ? "#1e1e3a" : "transparent", border: "none", color: layoutView === "list" ? "#a5b4fc" : "#555", padding: "10px 13px", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>☰</button>
                <button onClick={() => setLayoutView("board")} title="Board"
                  style={{ background: layoutView === "board" ? "#1e1e3a" : "transparent", border: "none", color: layoutView === "board" ? "#a5b4fc" : "#555", padding: "10px 13px", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>⊞</button>
              </div>
            </div>

            {/* BOARD VIEW */}
            {layoutView === "board" && (
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12, alignItems: "start" }}>
                {[["new","★ Novo","#3b82f6","#1e3a8a22"],["learning","? Učim","#e11d48","#6b153022"],["known","✓ Znam","#22c55e","#16653422"]].map(([status, label, color, bg]) => {
                  const col = words.filter(w => w.status === status && (search ? w.word.toLowerCase().includes(search.toLowerCase()) || w.translation?.toLowerCase().includes(search.toLowerCase()) : true));
                  return (
                    <div key={status} style={{ background: bg, border: "1px solid " + color + "33", borderRadius: 12, overflow: "hidden" }}>
                      <div style={{ padding: "10px 14px", borderBottom: "1px solid " + color + "33", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 12, fontFamily: "monospace", color: color, letterSpacing: 1 }}>{label}</span>
                        <span style={{ fontSize: 11, background: color + "22", color: color, borderRadius: 10, padding: "2px 8px", fontFamily: "monospace" }}>{col.length}</span>
                      </div>
                      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6, minHeight: 60 }}>
                        {col.length === 0 && <div style={{ color: "#333", fontSize: 12, textAlign: "center", padding: "16px 0" }}>—</div>}
                        {col.map(w => (
                          <div key={w.id} onClick={() => { setSelected(w); setView("detail"); setEditingTranslation(false); }}
                            style={{ background: "#0f0f1a", border: "1px solid #1e1e2e", borderRadius: 8, padding: "10px 12px", cursor: "pointer", transition: "border-color 0.15s" }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = color + "88"}
                            onMouseLeave={e => e.currentTarget.style.borderColor = "#1e1e2e"}>
                            <div style={{ fontSize: 14, fontStyle: "italic", color: "#f0ebe3", fontWeight: "bold", marginBottom: 2 }}>{w.word}</div>
                            {w.ipa && <div style={{ fontSize: 11, color: "#6366f1", fontFamily: "monospace", marginBottom: 3 }}>{w.ipa}</div>}
                            {w.translation && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{w.translation}</div>}
                            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                              {[["★","new","#3b82f6"],["?","learning","#e11d48"],["✓","known","#22c55e"]].map(([lbl, s, c]) => (
                                <button key={s} onClick={e => { e.stopPropagation(); updateStatus(w.id, s); }}
                                  style={{ background: w.status === s ? c : "transparent", border: "1px solid " + (w.status === s ? c : "rgba(255,255,255,0.15)"), color: w.status === s ? "#fff" : "rgba(255,255,255,0.2)", width: 22, height: 22, borderRadius: "50%", cursor: "pointer", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{lbl}</button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* LIST VIEW */}
            {layoutView === "list" && filteredWords.length === 0 ? (
              <div style={{ textAlign: "center", color: "#555", padding: 60 }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>📖</div>
                <div>Nema reči. Klikni + DODAJ!</div>
              </div>
            ) : layoutView === "list" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredWords.map(w => (
                  <div key={w.id}
                    onClick={() => { if (!combineMode) { setSelected(w); setView("detail"); setEditingTranslation(false); } else { setSelectedIds(prev => prev.includes(w.id) ? prev.filter(x => x !== w.id) : [...prev, w.id]); } }}
                    style={{ background: combineMode && selectedIds.includes(w.id) ? "linear-gradient(135deg, #312e81, #4338ca)" : statusBg[w.status], border: "2px solid " + (combineMode && selectedIds.includes(w.id) ? "#818cf8" : statusBorder[w.status]), borderRadius: 12, padding: "12px 16px", cursor: "pointer", display: "flex", flexDirection: "column", boxShadow: combineMode && selectedIds.includes(w.id) ? "0 0 16px rgba(129,140,248,0.4)" : "none", transition: "all 0.15s" }}>

                    {/* Tekst: reč + IPA + prevod */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: combineMode ? 0 : 8 }}>
                      {combineMode && (
                        <div style={{ width: 20, height: 20, borderRadius: 4, border: "2px solid " + (selectedIds.includes(w.id) ? "#818cf8" : "rgba(255,255,255,0.3)"), background: selectedIds.includes(w.id) ? "#6366f1" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, color: "#fff" }}>
                          {selectedIds.includes(w.id) ? "✓" : ""}
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 17, fontStyle: "italic", fontWeight: "bold", color: "#fff" }}>{w.word}</span>
                          {w.ipa && <span style={{ fontSize: 12, color: "#818cf8", fontFamily: "monospace", fontStyle: "normal" }}>{w.ipa}</span>}
                        </div>
                        {w.translation && <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>{w.translation}</div>}
                      </div>
                    </div>

                    {/* Status kružići */}
                    {!combineMode && (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                        {[["★","new","#3b82f6","Novo"],["?","learning","#e11d48","Učim"],["✓","known","#22c55e","Znam"]].map(([label, s, color, tip]) => (
                          <div key={s} style={{ position: "relative" }}>
                            <button onClick={e => { e.stopPropagation(); updateStatus(w.id, s); }}
                              style={{ background: w.status === s ? color : "transparent", border: "1px solid " + (w.status === s ? color : "rgba(255,255,255,0.2)"), color: w.status === s ? "#fff" : "rgba(255,255,255,0.25)", width: 24, height: 24, borderRadius: "50%", cursor: "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                              onMouseEnter={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }}
                              onMouseLeave={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}
                            >{label}</button>
                            <div className="tip" style={{ position: "absolute", bottom: 30, left: "50%", transform: "translateX(-50%)", background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#fff", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>{tip}</div>
                          </div>
                        ))}
                        <div style={{ position: "relative" }}>
                          <button onClick={e => { e.stopPropagation(); if (window.confirm(`Obrisati "${w.word}"?`)) deleteWord(w.id); }}
                            style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "rgba(255,255,255,0.3)", width: 24, height: 24, borderRadius: "50%", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.3)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}>✕</button>
                          <div className="tip" style={{ position: "absolute", bottom: 30, left: "50%", transform: "translateX(-50%)", background: "#1a1a2e", border: "1px solid #2a2a3e", color: "#fff", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>Briši</div>
                        </div>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontFamily: "monospace", marginLeft: 4 }}>{formatDate(w.addedAt)}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ADD VIEW */}
        {view === "add" && (
          <div>
            <button onClick={() => { setView("list"); setAiData(null); setWordInput(""); setAiError(null); }}
              style={{ background: "none", border: "none", color: "#6366f1", cursor: "pointer", fontSize: 14, marginBottom: 20, fontFamily: "Georgia, serif" }}>← Nazad</button>

            <div style={{ background: "#1a1a2e", border: "1px solid #2a2a3e", borderRadius: 16, padding: 24 }}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11, letterSpacing: 3, color: "#6366f1", marginBottom: 8, textTransform: "uppercase" }}>Engleska reč ili fraza</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={wordInput} onChange={e => setWordInput(e.target.value)} onKeyDown={e => e.key === "Enter" && lookupWord()}
                    placeholder="npr. serendipity, give up..."
                    style={{ flex: 1, background: "#12121a", border: "1px solid #2a2a3e", color: "#f0ebe3", padding: "11px 14px", borderRadius: 8, fontSize: 15, fontFamily: "Georgia, serif" }} />
                  <button onClick={lookupWord} disabled={aiLoading || !wordInput.trim()}
                    style={{ background: aiLoading ? "#2a2a3e" : "#6366f1", border: "none", color: "#fff", padding: "11px 20px", borderRadius: 8, cursor: aiLoading ? "default" : "pointer", fontSize: 14, fontFamily: "monospace", whiteSpace: "nowrap" }}>
                    {aiLoading ? "⟳" : "Pretraži"}
                  </button>
                </div>
              </div>

              {aiError && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{aiError}</div>}

              {aiData && (
                <div>
                  <div style={{ borderTop: "1px solid #2a2a3e", paddingTop: 16, marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
                      <div style={{ fontSize: 22, color: "#f0ebe3", fontStyle: "italic" }}>{aiData.wordEn}</div>
                      {aiData.ipa && <div style={{ fontSize: 13, color: "#6366f1", fontFamily: "monospace" }}>{aiData.ipa}</div>}
                    </div>
                    <div style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>{aiData.partOfSpeech}</div>
                    <div style={{ fontSize: 18, color: "#a5b4fc", marginBottom: 8 }}>{aiData.wordSr}</div>
                    {aiData.synonyms?.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                        {aiData.synonyms.map((s, i) => (
                          <span key={i} style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", color: "#a5b4fc", padding: "3px 10px", borderRadius: 20, fontSize: 12 }}>{s}</span>
                        ))}
                      </div>
                    )}
                    {aiData.sentences?.length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 11, letterSpacing: 2, color: "#555", marginBottom: 8, textTransform: "uppercase" }}>Primeri</div>
                        {aiData.sentences.map((s, i) => (
                          <div key={i} style={{ fontSize: 13, color: "#999", lineHeight: 1.6, marginBottom: 4, paddingLeft: 12, borderLeft: "2px solid #2a2a3e" }}>
                            {highlightWord(s, aiData.wordEn)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: "block", fontSize: 11, letterSpacing: 3, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Tvoj primer (opciono)</label>
                    <input value={customSentence} onChange={e => setCustomSentence(e.target.value)} placeholder="Napiši vlastitu rečenicu..."
                      style={{ width: "100%", background: "#12121a", border: "1px solid #2a2a3e", color: "#f0ebe3", padding: "10px 14px", borderRadius: 8, fontSize: 14, fontFamily: "Georgia, serif", boxSizing: "border-box" }} />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: "block", fontSize: 11, letterSpacing: 3, color: "#6366f1", marginBottom: 6, textTransform: "uppercase" }}>Napomena (opciono)</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Kontekst, gde si čuo reč..."
                      style={{ width: "100%", background: "#12121a", border: "1px solid #2a2a3e", color: "#f0ebe3", padding: "10px 14px", borderRadius: 8, fontSize: 14, fontFamily: "Georgia, serif", resize: "vertical", boxSizing: "border-box" }} />
                  </div>
                  <button onClick={saveWord} disabled={saving}
                    style={{ width: "100%", background: saving ? "#2a2a3e" : "#6366f1", border: "none", color: "#fff", padding: "13px", borderRadius: 10, cursor: saving ? "default" : "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 1 }}>
                    DODAJ U LISTU →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* DETAIL VIEW */}
        {view === "detail" && selected && (
          <div>
            <button onClick={() => { setView("list"); setEditingTranslation(false); }}
              style={{ background: "none", border: "none", color: "#6366f1", cursor: "pointer", fontSize: 14, marginBottom: 20, fontFamily: "Georgia, serif" }}>← Nazad</button>

            <div style={{ background: selected.status === "known" ? "linear-gradient(160deg, #0d2e1a, #0f3d22)" : selected.status === "learning" ? "linear-gradient(160deg, #2a0812, #3d0f1a)" : "#1a1a2e", borderRadius: 16, padding: 28, border: "1px solid " + (selected.status === "known" ? "#22c55e44" : selected.status === "learning" ? "#e11d4844" : "#2a2a3e"), transition: "background 0.4s, border-color 0.4s" }}>

              {/* Word header */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                  <h2 style={{ margin: 0, fontSize: 28, fontStyle: "italic", fontWeight: "normal" }}>{selected.word}</h2>
                  {selected.ipa && <span style={{ fontSize: 15, color: "#818cf8", fontFamily: "monospace" }}>{selected.ipa}</span>}
                </div>
                {selected.partOfSpeech && <div style={{ fontSize: 12, color: "#555", fontFamily: "monospace", marginBottom: 8 }}>{selected.partOfSpeech}</div>}

                {/* Translation with edit */}
                {editingTranslation ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input value={editTranslationVal} onChange={e => setEditTranslationVal(e.target.value)}
                      style={{ flex: 1, background: "#12121a", border: "1px solid #6366f1", color: "#a5b4fc", padding: "8px 12px", borderRadius: 8, fontSize: 16, fontFamily: "Georgia, serif" }} />
                    <button onClick={async () => {
                      setWords(prev => prev.map(w => w.id === selected.id ? { ...w, wordSr: editTranslationVal, translation: editTranslationVal } : w));
                      setSelected(prev => ({ ...prev, wordSr: editTranslationVal, translation: editTranslationVal }));
                      setEditingTranslation(false);
                      try { await db.updateTranslation(token, selected.id, editTranslationVal); } catch(e) {}
                    }} style={{ background: "#22c55e", border: "none", color: "#fff", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>✓</button>
                    <button onClick={() => setEditingTranslation(false)}
                      style={{ background: "transparent", border: "1px solid #555", color: "#888", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 20, color: "#a5b4fc" }}>{selected.translation || selected.wordSr}</div>
                    <button onClick={() => { setEditTranslationVal(selected.translation || selected.wordSr || ""); setEditingTranslation(true); }}
                      style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, padding: "0 4px" }}>✎</button>
                  </div>
                )}
              </div>

              {/* Synonyms */}
              {selected.synonyms?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, letterSpacing: 3, color: "#555", marginBottom: 8, textTransform: "uppercase" }}>Sinonimi</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {selected.synonyms.map((s, i) => (
                      <span key={i} style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", color: "#a5b4fc", padding: "4px 12px", borderRadius: 20, fontSize: 13 }}>{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Sentences */}
              {selected.sentences?.length > 0 && (
                <div style={{ marginBottom: 16 }} onMouseUp={handleTextSelect}>
                  <div style={{ fontSize: 11, letterSpacing: 3, color: "#555", marginBottom: 8, textTransform: "uppercase" }}>Primeri upotrebe</div>
                  {selected.sentences.map((s, i) => (
                    <div key={i} style={{ fontSize: 14, color: "#ccc", lineHeight: 1.7, marginBottom: 8, paddingLeft: 14, borderLeft: "2px solid #2a2a3e" }}>
                      {highlightWord(s, selected.word)}
                    </div>
                  ))}
                </div>
              )}

              {/* Notes */}
              {selected.notes && (
                <div style={{ marginBottom: 16, padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid #2a2a3e" }}>
                  <div style={{ fontSize: 11, letterSpacing: 3, color: "#555", marginBottom: 4, textTransform: "uppercase" }}>Napomena</div>
                  <div style={{ fontSize: 13, color: "#888", lineHeight: 1.6 }}>{selected.notes}</div>
                </div>
              )}

              {/* Status buttons */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {[["★","new","#3b82f6","Novo"],["?","learning","#e11d48","Učim"],["✓","known","#22c55e","Znam"]].map(([label, s, color, tip]) => (
                  <button key={s} onClick={() => updateStatus(selected.id, s)}
                    style={{ background: selected.status === s ? color : "transparent", border: "1px solid " + (selected.status === s ? color : "rgba(255,255,255,0.2)"), color: selected.status === s ? "#fff" : "rgba(255,255,255,0.5)", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: "monospace", transition: "all 0.15s" }}>
                    {label} {tip}
                  </button>
                ))}
              </div>

              {/* Footer meta */}
              <div style={{ display: "flex", gap: 16, fontSize: 11, color: "#555", fontFamily: "monospace", flexWrap: "wrap" }}>
                <span>Dodano: {formatDate(selected.addedAt)}</span>
                <span>Ponavljano: {selected.reviewCount || 0}×</span>
                {selected.learnedAt && <span style={{ color: "#22c55e" }}>Naučeno: {formatDate(selected.learnedAt)}</span>}
              </div>
            </div>
          </div>
        )}

        {/* COMBINE RESULT VIEW */}
        {view === "combine" && combineResult && (
          <div>
            <button onClick={() => setView("list")}
              style={{ background: "none", border: "none", color: "#6366f1", cursor: "pointer", fontSize: 14, marginBottom: 20, fontFamily: "Georgia, serif" }}>← Nazad</button>
            <div style={{ background: "#1a1a2e", border: "1px solid #2a2a3e", borderRadius: 16, padding: 24 }}>
              <div style={{ fontSize: 11, letterSpacing: 3, color: "#6366f1", marginBottom: 12, textTransform: "uppercase" }}>Kombinovane reči</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                {combineResult.words.map(w => (
                  <span key={w.id} style={{ background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.4)", color: "#a5b4fc", padding: "4px 12px", borderRadius: 20, fontSize: 13, fontStyle: "italic" }}>{w.word}</span>
                ))}
              </div>
              <div style={{ fontSize: 11, letterSpacing: 3, color: "#555", marginBottom: 12, textTransform: "uppercase" }}>Primeri</div>
              {combineResult.sentences.map((s, i) => (
                <div key={i} style={{ fontSize: 14, color: "#ccc", lineHeight: 1.7, marginBottom: 10, paddingLeft: 14, borderLeft: "2px solid #6366f1" }}
                  onMouseUp={handleTextSelect}>{s}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* POPUP */}
      {popup && (
        <div ref={popupRef} style={{ position: "absolute", top: popup.y, left: Math.max(8, Math.min(popup.x, window.innerWidth - 170)), background: "#1a1a2e", border: "1px solid #6366f1", borderRadius: 10, padding: "8px 14px", zIndex: 1000, boxShadow: "0 4px 20px rgba(99,102,241,0.4)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, color: "#a5b4fc", fontStyle: "italic" }}>"{popup.text}"</span>
          <button onClick={handlePopupLookup} style={{ background: "#6366f1", border: "none", color: "#fff", padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>Dodaj +</button>
          <button onClick={() => setPopup(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", background: "#1a1a2e", border: "1px solid #6366f1", color: "#a5b4fc", padding: "10px 24px", borderRadius: 30, fontSize: 14, fontFamily: "monospace", zIndex: 9999, boxShadow: "0 4px 20px rgba(99,102,241,0.3)" }}>{toast}</div>
      )}

      {/* FAB buttons */}
      {view === "list" && !combineMode && (
        <button onClick={() => { setView("add"); setAiData(null); setWordInput(""); setAiError(null); }}
          style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", background: "#d97706", border: "none", color: "#fff", padding: "14px 36px", borderRadius: 50, cursor: "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 2, boxShadow: "0 4px 24px rgba(217,119,6,0.5)", zIndex: 100, whiteSpace: "nowrap" }}>+ DODAJ REČ</button>
      )}
      {view === "list" && combineMode && (
        <button onClick={generateCombined} disabled={selectedIds.length < 2 || combineLoading}
          style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", background: selectedIds.length >= 2 ? "#6366f1" : "#2a2a3e", border: "none", color: selectedIds.length >= 2 ? "#fff" : "#555", padding: "14px 36px", borderRadius: 50, cursor: selectedIds.length >= 2 ? "pointer" : "default", fontSize: 15, fontFamily: "monospace", letterSpacing: 1, boxShadow: selectedIds.length >= 2 ? "0 4px 24px rgba(99,102,241,0.5)" : "none", zIndex: 100, whiteSpace: "nowrap", transition: "all 0.2s" }}>
          {combineLoading ? "⟳ Generišem..." : selectedIds.length < 2 ? `Označi min. 2 reči (${selectedIds.length})` : `⊕ Generiši primere (${selectedIds.length})`}
        </button>
      )}

      <style>{`* { outline: none; } input, textarea { transition: border-color 0.2s; } input:focus, textarea:focus { border-color: #6366f1 !important; } input::placeholder, textarea::placeholder { color: #444; }`}</style>
    </div>
  );
}

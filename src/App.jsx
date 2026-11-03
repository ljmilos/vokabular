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

const smartDb = {
  async load(token) {
    const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` };
    const [scheduleResponse, historyResponse] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/vocab_srs_schedule?select=word_id,due_at,interval_days,streak,repetitions,last_rating&limit=10000`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/vocab_review_history?select=word_id,rating,reviewed_at&order=reviewed_at.desc&limit=10000`, { headers })
    ]);
    if (!scheduleResponse.ok || !historyResponse.ok) {
      throw new Error("Smart Learning tabela nije dostupna. Prvo pokreni SQL migraciju iz ZIP paketa.");
    }
    return { schedule: await scheduleResponse.json(), history: await historyResponse.json() };
  },
  async rate(token, wordId, rating, requestId) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_vocab_review`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_word_id: String(wordId), p_rating: rating, p_request_id: requestId })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || "Nije uspelo čuvanje odgovora u Supabase-u.");
    return result;
  }
};

function getLocalDayStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

const db = {
  async getAll(token) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?order=added_at.desc`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    });
    return res.json();
  },
  async insert(w, token) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/vocabulary`, {
      method: "POST",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Prefer": "return=representation" },
      body: JSON.stringify({ word: w.word, word_sr: w.wordSr, translation: w.translation, ipa: w.ipa, part_of_speech: w.partOfSpeech, synonyms: w.synonyms, sentences: w.sentences, notes: w.notes, status: "new", review_count: 0, image_url: w.imageUrl || null })
    });
    const data = await res.json();
    return data[0];
  },
  async updateStatus(id, status, reviewCount, learnedAt, token) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status, review_count: reviewCount + 1, learned_at: learnedAt || null })
    });
  },
  async updateSentences(id, sentences, token) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sentences })
    });
  },
  async updateTranslation(id, wordSr, token) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ word_sr: wordSr, translation: wordSr })
    });
  },
  async updateImageUrl(id, imageUrl, token) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "PATCH",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: imageUrl })
    });
  },
  async delete(id, token) {
    await fetch(`${SUPABASE_URL}/rest/v1/vocabulary?id=eq.${id}`, {
      method: "DELETE",
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${token}` }
    });
  }
};

function normalize(r) {
  return { id: r.id, word: r.word, wordSr: r.word_sr, translation: r.word_sr || r.translation, ipa: r.ipa || "", partOfSpeech: r.part_of_speech, synonyms: r.synonyms || [], sentences: r.sentences || [], notes: r.notes || "", status: r.status || "new", addedAt: r.added_at, reviewCount: r.review_count || 0, learnedAt: r.learned_at, imageUrl: r.image_url || null };
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("sr-RS", { day: "2-digit", month: "short", year: "numeric" });
}

function highlightWord(sentence, word) {
  if (!word || !sentence) return sentence;
  const escaped = word.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(${escaped})`, "gi");
  const parts = sentence.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? <strong key={i} style={{ color: "#fff", fontWeight: 700 }}>{part}</strong> : part
  );
}


// Teme su na jednom mestu: nove teme se dodaju samo ovde.
const VOCAB_THEMES = {
  midnight: { name: "Midnight Pro", description: "Tamna indigo", colors: {
    bg: "#0b1020", panel: "#151d32", card: "#1b2741", elevated: "#202d49", border: "#344361", text: "#edf2ff", muted: "#9aabc9", subtle: "#7283a5", accent: "#7775f7", accentText: "#ffffff", accentSoft: "#aeb7ff", header: "#171f38", input: "#111b2e", dangerBg: "#321b2a", dangerBorder: "#6a3146", knownBg: "#172f2c", learningBg: "#361e2e", newBg: "#1b2b46", selectedBg: "#35316c", statusInactive: "#8694b1", action: "#d18a2d" } },
  ocean: { name: "Deep Ocean", description: "Tamna tirkizna", colors: {
    bg: "#061b25", panel: "#0c2935", card: "#103541", elevated: "#174450", border: "#285462", text: "#e9fcff", muted: "#99bec9", subtle: "#6a929f", accent: "#19b9b4", accentText: "#052528", accentSoft: "#6ce6de", header: "#0b2b39", input: "#0b252f", dangerBg: "#38212d", dangerBorder: "#7d4655", knownBg: "#153c36", learningBg: "#3c2735", newBg: "#15384b", selectedBg: "#19545d", statusInactive: "#96b8c4", action: "#c68529" } },
  graphite: { name: "Graphite Gold", description: "Ugalj i zlato", colors: {
    bg: "#111214", panel: "#1c1e20", card: "#242629", elevated: "#303235", border: "#414448", text: "#f3f0e9", muted: "#afada9", subtle: "#858689", accent: "#dba954", accentText: "#241a0b", accentSoft: "#edc989", header: "#1c1d20", input: "#1b1c1e", dangerBg: "#382427", dangerBorder: "#704247", knownBg: "#25392e", learningBg: "#3b292d", newBg: "#263440", selectedBg: "#4a3a29", statusInactive: "#aaa7a0", action: "#c58e35" } },
  ivory: { name: "Ivory Paper", description: "Topla svetla", colors: {
    bg: "#f7f5ef", panel: "#fffdf8", card: "#ffffff", elevated: "#f0eee7", border: "#dedbd2", text: "#262c36", muted: "#6b7481", subtle: "#9299a2", accent: "#4e64c8", accentText: "#ffffff", accentSoft: "#455cb5", header: "#fffdf8", input: "#ffffff", dangerBg: "#fff0f0", dangerBorder: "#edc9cc", knownBg: "#eff9f2", learningBg: "#fff0f2", newBg: "#f0f5fd", selectedBg: "#edf0ff", statusInactive: "#7b8490", action: "#cb8327" } },
  arctic: { name: "Arctic Blue", description: "Moderna svetla", colors: {
    bg: "#edf4fb", panel: "#ffffff", card: "#f8fbff", elevated: "#eaf2fc", border: "#cfdeec", text: "#172d45", muted: "#637c95", subtle: "#879bb0", accent: "#1678d4", accentText: "#ffffff", accentSoft: "#126ab7", header: "#ffffff", input: "#ffffff", dangerBg: "#fff0f3", dangerBorder: "#f1cbd2", knownBg: "#eaf9f4", learningBg: "#fff0f3", newBg: "#eaf4ff", selectedBg: "#e0efff", statusInactive: "#788fa8", action: "#d28a29" } }
};
const VOCAB_THEME_IDS = Object.keys(VOCAB_THEMES);

export default function VocabTracker() {
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem("sb_token") || null);
  const [authView, setAuthView] = useState("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);

  const [words, setWords] = useState([]);
  const [view, setView] = useState("list");
  const [layoutView, setLayoutView] = useState("list"); // "list" | "board"
  const [workspaceTab, setWorkspaceTab] = useState("home"); // "home" | "dictionary"
  const [wordInput, setWordInput] = useState("");
  const [aiData, setAiData] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [practiceShuffle, setPracticeShuffle] = useState(false);
  const [practiceAnswers, setPracticeAnswers] = useState({});
  const [practiceMode, setPracticeMode] = useState("smart"); // smart | free
  const [srsSchedules, setSrsSchedules] = useState({});
  const [srsHistory, setSrsHistory] = useState([]);
  const [srsReady, setSrsReady] = useState(false);
  const [srsError, setSrsError] = useState("");
  const [srsSaving, setSrsSaving] = useState(false);
  const [sessionReviewed, setSessionReviewed] = useState([]);
  const [dayGoal, setDayGoal] = useState(() => {
    const stored = Number(localStorage.getItem("vocab_daily_goal"));
    return [10, 15, 20, 30, 50].includes(stored) ? stored : 20;
  });
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [themeId, setThemeId] = useState(() => {
    try {
      const saved = localStorage.getItem("vocab_theme");
      return VOCAB_THEME_IDS.includes(saved) ? saved : "ivory";
    } catch { return "ivory"; }
  });
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const theme = VOCAB_THEMES[themeId];
  const chooseTheme = (id) => {
    if (!VOCAB_THEMES[id]) return;
    setThemeId(id);
    setThemeMenuOpen(false);
    try { localStorage.setItem("vocab_theme", id); } catch { /* bez memorije u privatnom modu */ }
  };
  // CSS varijable se postavljaju na <html>, zato tema važi i za login i modalne prikaze.
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(theme.colors).forEach(([name, value]) => root.style.setProperty(`--v-${name}`, value));
    root.style.colorScheme = ["ivory", "arctic"].includes(themeId) ? "light" : "dark";
    return () => { root.style.colorScheme = ""; };
  }, [themeId]);

  const [sortOrder, setSortOrder] = useState(() => {
    const saved = localStorage.getItem("vocab_sort");
    return ["newest", "oldest", "az", "za"].includes(saved) ? saved : "newest";
  });
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== "undefined" && window.innerWidth < 600); // NEW
  const debounceRef = useRef(null);

  // NEW: track screen width
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("access_token=")) {
      const params = new URLSearchParams(hash.replace("#", ""));
      const accessToken = params.get("access_token");
      if (accessToken) {
        window.history.replaceState(null, "", window.location.pathname);
        setEmailConfirmed(true);
        setLoading(false);
        return;
      }
    }
    const savedToken = localStorage.getItem("sb_token");
    if (savedToken) {
      supabaseAuth.getUser(savedToken).then(async u => {
        if (u?.id) {
          setUser(u);
          setToken(savedToken);
          const rows = await db.getAll(savedToken);
          if (Array.isArray(rows)) setWords(rows.map(normalize));
          setLoading(false);
        } else {
          localStorage.removeItem("sb_token");
          setLoading(false);
        }
      }).catch(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id || !token) {
      setSrsSchedules({}); setSrsHistory([]); setSrsReady(false); setSrsError("");
      return;
    }
    let cancelled = false;
    setSrsReady(false);
    setSrsError("");
    smartDb.load(token).then(data => {
      if (cancelled) return;
      setSrsSchedules(Object.fromEntries(data.schedule.map(row => [String(row.word_id), row])));
      setSrsHistory(data.history);
      setSrsReady(true);
    }).catch(error => {
      if (!cancelled) { setSrsError(error.message); setSrsReady(false); }
    });
    return () => { cancelled = true; };
  }, [user?.id, token]);

  const showToast = (msg, color = "#22c55e") => { setToast({ msg, color }); setTimeout(() => setToast(null), 2500); };

  const lookupWord = async (word) => {
    if (!word.trim() || word.trim().length < 2) { setAiData(null); return; }
    const cached = words.find(w => w.word.toLowerCase() === word.trim().toLowerCase() || w.wordSr?.toLowerCase() === word.trim().toLowerCase());
    if (cached) { setAiData({ wordEn: cached.word, wordSr: cached.wordSr, translation: cached.translation, partOfSpeech: cached.partOfSpeech, sentences: cached.sentences }); return; }
    setAiLoading(true); setAiError(null); setAiData(null);
    try {
      const res = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 500, messages: [{ role: "user", content: `You are a dictionary for a Serbian B1 English learner. User typed: "${word.trim()}". Detect if English or Serbian. RULE: wordEn MUST always be the English word/phrase, wordSr MUST always be the Serbian word/phrase. If user typed Serbian, translate to English for wordEn. If user typed English, translate to Serbian for wordSr. Include 3-10 English synonyms (only real synonyms, as many as truly exist). 3 natural example sentences in English with Serbian translations, varied contexts. Reply ONLY valid JSON, no markdown:\n{"wordEn":"ENGLISH word","wordSr":"SRPSKA rec","partOfSpeech":"type","ipa":"/IPA pronunciation/","synonyms":["syn1","syn2","syn3"],"sentences":[{"en":"s1","sr":"p1"},{"en":"s2","sr":"p2"},{"en":"s3","sr":"p3"}]}` }] })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      setAiData(JSON.parse(text.replace(/```json|```/g, "").trim()));
    } catch (e) { setAiError("Greška pri učitavanju. Pokušaj ponovo."); }
    setAiLoading(false);
  };

  const regenerateSentences = async (word, setter, currentSentences) => {
    if ((currentSentences?.length || 0) >= 10) { showToast("Maksimum 10 primera!", "#f59e0b"); return; }
    setRegenLoading(true);
    try {
      const res = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 200, messages: [{ role: "user", content: `Give me 1 NEW example sentence for "${word}", NOT these:\n${currentSentences?.map(s => "- " + (s.en || s)).join("\n")}\nReply ONLY JSON object:\n{"en":"new sentence","sr":"prevod na srpski"}` }] })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      const newSentence = JSON.parse(text.replace(/```json|```/g, "").trim());
      setter(prev => [...(prev || currentSentences), newSentence]);
      showToast("Primer dodat ✓");
    } catch (e) { showToast("Greška, pokušaj ponovo", "#ef4444"); }
    setRegenLoading(false);
  };

  const handleWordInput = (val) => { setWordInput(val); setAiData(null); setAiError(null); };

  const addWord = async () => {
    if (!wordInput.trim() || !aiData) return;
    const duplicate = words.find(w => w.word.toLowerCase() === (aiData.wordEn || wordInput.trim()).toLowerCase());
    if (duplicate) { showToast("Reč već postoji!", "#f59e0b"); return; }
    setSaving(true);
    try {
      const row = await db.insert({ word: aiData.wordEn || wordInput.trim(), wordSr: aiData.wordSr, translation: aiData.wordSr, ipa: aiData.ipa || "", partOfSpeech: aiData.partOfSpeech, synonyms: aiData.synonyms || [], sentences: aiData.sentences, notes: notes.trim(), imageUrl: null }, token);
      if (row) setWords(prev => [normalize(row), ...prev]);
      setWordInput(""); setAiData(null); setNotes(""); setView("list");
      showToast("Reč sačuvana ✓");
    } catch (e) { showToast("Greška pri čuvanju", "#ef4444"); }
    setSaving(false);
  };

  const updateStatus = async (id, status) => {
    const w = words.find(x => x.id === id);
    const learnedAt = status === "known" ? new Date().toISOString() : null;
    await db.updateStatus(id, status, w?.reviewCount || 0, learnedAt, token);
    setWords(prev => prev.map(x => x.id === id ? { ...x, status, reviewCount: (x.reviewCount || 0) + 1, learnedAt } : x));
  };

  const deleteWord = async (id) => {
    await db.delete(id, token);
    setWords(prev => prev.filter(x => x.id !== id)); setView("list");
    showToast("Obrisano", "#ef4444");
  };

  // Jedinstven redosled za listu, Board i PDF; bez izmena u Supabase bazi.
  const sortedWords = [...words].sort((a, b) => {
    if (sortOrder === "az") return (a.word || "").localeCompare(b.word || "", "en", { sensitivity: "base" });
    if (sortOrder === "za") return (b.word || "").localeCompare(a.word || "", "en", { sensitivity: "base" });
    const aTime = a.addedAt ? new Date(a.addedAt).getTime() || 0 : 0;
    const bTime = b.addedAt ? new Date(b.addedAt).getTime() || 0 : 0;
    return sortOrder === "oldest" ? aTime - bTime : bTime - aTime;
  });
  const searchedWords = sortedWords.filter(w =>
    (w.word || "").toLowerCase().includes(search.toLowerCase()) ||
    (w.translation || "").toLowerCase().includes(search.toLowerCase())
  );
  const filteredWords = searchedWords.filter(w => filter === "all" || w.status === filter);

  const todayStart = getLocalDayStart();
  const todaysReviews = srsHistory.filter(r => new Date(r.reviewed_at).getTime() >= todayStart);
  const todayCorrect = todaysReviews.filter(r => r.rating === "good").length;
  const dueWords = words.filter(w => {
    const schedule = srsSchedules[String(w.id)];
    return !schedule?.due_at || new Date(schedule.due_at).getTime() <= Date.now();
  }).sort((a, b) => {
    const dateA = srsSchedules[String(a.id)]?.due_at || "";
    const dateB = srsSchedules[String(b.id)]?.due_at || "";
    return dateA.localeCompare(dateB) || String(a.word).localeCompare(String(b.word), "en");
  });
  // Smart mode: one assessment per word per session. Free mode never writes SRS data.
  const reviewWords = (practiceMode === "smart" ? dueWords.filter(w => !sessionReviewed.includes(String(w.id))) : [...words])
    .sort((a, b) => practiceShuffle ? String(b.id).localeCompare(String(a.id)) :
      practiceMode === "smart" ? 0 : (a.addedAt || "").localeCompare(b.addedAt || ""));
  const currentReview = reviewWords[reviewIndex % Math.max(1, reviewWords.length)];
  const smartRemaining = reviewWords.length;
  const statusLabel = s => ({ new: "Novo", learning: "Učim", known: "Znam" }[s] || s);
  const statusDot = s => ({ new: "#3b82f6", learning: "#f59e0b", known: "#22c55e" }[s] || "var(--v-muted)");
  const counts = { all: words.length, new: words.filter(w => w.status === "new").length, learning: words.filter(w => w.status === "learning").length, known: words.filter(w => w.status === "known").length };
  const inp = { width: "100%", background: "var(--v-input)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "11px 14px", borderRadius: 8, fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box" };

  const [popup, setPopup] = useState(null);
  const [quickAdding, setQuickAdding] = useState(false);
  const [editingTranslation, setEditingTranslation] = useState(false);
  const [editTranslationVal, setEditTranslationVal] = useState("");
  const [combineMode, setCombineMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [combineResult, setCombineResult] = useState(null);
  const [combineLoading, setCombineLoading] = useState(false);
  const [savingTo, setSavingTo] = useState(null);
  const [wordImage, setWordImage] = useState(null);
  const [imageLoading, setImageLoading] = useState(false);

  const handleQuickAdd = async (word) => {
    if (!word || word.trim().length < 2) return;
    const already = words.find(w => w.word.toLowerCase() === word.trim().toLowerCase() || w.wordSr?.toLowerCase() === word.trim().toLowerCase());
    if (already) { showToast("Već postoji u rečniku!", "#f59e0b"); setPopup(null); return; }
    setQuickAdding(true); setPopup(null);
    try {
      const res = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 500, messages: [{ role: "user", content: `You are a dictionary for a Serbian B1 English learner. User typed: "${word.trim()}". Detect if English or Serbian. RULE: wordEn MUST always be the English word/phrase, wordSr MUST always be the Serbian word/phrase. If user typed Serbian, translate to English for wordEn. If user typed English, translate to Serbian for wordSr. Include 3-10 English synonyms (only real synonyms, as many as truly exist). 3 natural example sentences in English with Serbian translations, varied contexts. Reply ONLY valid JSON, no markdown:\n{"wordEn":"ENGLISH word","wordSr":"SRPSKA rec","partOfSpeech":"type","ipa":"/IPA pronunciation/","synonyms":["syn1","syn2"],"sentences":[{"en":"s1","sr":"p1"},{"en":"s2","sr":"p2"},{"en":"s3","sr":"p3"}]}` }] })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      const ai = JSON.parse(text.replace(/```json|```/g, "").trim());
      const row = await db.insert({ word: ai.wordEn || word.trim(), wordSr: ai.wordSr, translation: ai.wordSr, ipa: ai.ipa || "", partOfSpeech: ai.partOfSpeech, synonyms: ai.synonyms || [], sentences: ai.sentences, notes: "", imageUrl: null }, token);
      if (row) setWords(prev => [normalize(row), ...prev]);
      showToast(`"${ai.wordEn}" dodato u rečnik ✓`);
    } catch (e) { showToast("Greška, pokušaj ponovo", "#ef4444"); }
    setQuickAdding(false);
  };

  const handleWordClick = (e, word) => {
    e.stopPropagation();
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;
    const clean = word.replace(/[^a-zA-ZčćžšđČĆŽŠĐ\s'-]/g, "").trim();
    if (!clean || clean.length < 2) return;
    const rect = e.target.getBoundingClientRect();
    setPopup({ word: clean, x: rect.left + rect.width / 2, y: rect.bottom + 8 });
  };

  const ClickableSentence = ({ text, highlightTarget }) => {
    const onMouseUpHandler = e => {
      const sel = window.getSelection();
      const selected = sel?.toString().trim();
      if (selected && selected.length >= 2 && selected.length <= 60) {
        const range = sel.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setPopup({ word: selected, x: rect.left + rect.width / 2, y: rect.bottom + 8 });
      }
    };
    if (highlightTarget && highlightTarget.trim().includes(" ")) {
      const escaped = highlightTarget.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(${escaped})`, "gi");
      const parts = text.split(regex);
      return (
        <span onMouseUp={onMouseUpHandler}>
          {parts.map((part, i) => regex.test(part) ? <strong key={i} style={{ color: "#fff", fontWeight: 700 }}>{part}</strong> : <span key={i}>{part}</span>)}
        </span>
      );
    }
    const tokens = text.split(/(\s+)/);
    return (
      <span onMouseUp={onMouseUpHandler}>
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

  const SentenceCard = ({ s, i, word, onDelete, onUpdate }) => {
    const [editing, setEditing] = useState(false);
    const [editEn, setEditEn] = useState(s.en || s);
    const [editSr, setEditSr] = useState(s.sr || "");
    if (editing) {
      return (
        <div style={{ background: "rgba(99,102,241,0.12)", borderLeft: "2px solid var(--v-accent)", padding: "12px 14px", borderRadius: "0 8px 8px 0", marginBottom: 10 }}>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "var(--v-accent)", letterSpacing: 2, marginBottom: 4, textTransform: "uppercase" }}>Engleski</div>
            <textarea value={editEn} onChange={e => setEditEn(e.target.value)} rows={2} style={{ width: "100%", background: "var(--v-input)", border: "1px solid var(--v-accent)", color: "var(--v-text)", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "Georgia, serif", resize: "vertical", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "var(--v-accent)", letterSpacing: 2, marginBottom: 4, textTransform: "uppercase" }}>Srpski</div>
            <textarea value={editSr} onChange={e => setEditSr(e.target.value)} rows={2} style={{ width: "100%", background: "var(--v-input)", border: "1px solid var(--v-accent)", color: "var(--v-text)", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "Georgia, serif", resize: "vertical", boxSizing: "border-box" }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { onUpdate(i, { en: editEn, sr: editSr }); setEditing(false); }} style={{ background: "#22c55e", border: "none", color: "#fff", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>✓ Sačuvaj</button>
            <button onClick={() => setEditing(false)} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>✕ Odustani</button>
          </div>
        </div>
      );
    }
    return (
      <div style={{ background: "rgba(99,102,241,0.07)", borderLeft: "2px solid var(--v-accent)", padding: "10px 14px", borderRadius: "0 8px 8px 0", marginBottom: 10 }}>
        <div style={{ fontSize: 14, lineHeight: 1.65, color: "var(--v-text)", marginBottom: 4, display: "flex", alignItems: "flex-start", gap: 6 }}>
          <span style={{ color: "var(--v-accent)", fontFamily: "monospace", fontSize: 11, marginRight: 2, flexShrink: 0, marginTop: 2 }}>{i + 1}.</span>
          <span style={{ flex: 1 }}><ClickableSentence text={s.en || s} highlightTarget={word} /></span>
          <button onClick={() => speak(s.en || s)} title="Izgovori" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "0 2px", opacity: 0.5, flexShrink: 0 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}>🔊</button>
          <button onClick={() => { setEditEn(s.en || s); setEditSr(s.sr || ""); setEditing(true); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: "0 2px", opacity: 0.5, flexShrink: 0, color: "var(--v-accentSoft)" }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}>✎</button>
          <button onClick={() => onDelete(i)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: "0 2px", opacity: 0.5, flexShrink: 0, color: "#ef4444" }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}>✕</button>
        </div>
        {s.sr && <div style={{ fontSize: 12, color: "var(--v-muted)", fontStyle: "italic", paddingLeft: 20 }}>↳ {s.sr}</div>}
      </div>
    );
  };

  const fetchImage = async (word, cachedUrl = null, wordId = null) => {
    if (cachedUrl) { setWordImage({ url: cachedUrl, cached: true }); return; }
    setWordImage(null); setImageLoading(true);
    try {
      const res = await fetch(`/api/unsplash?query=${encodeURIComponent(word)}`);
      const data = await res.json();
      const photo = data.results?.[0];
      if (photo) {
        const imgUrl = photo.urls.small;
        setWordImage({ url: imgUrl, author: photo.user.name, authorUrl: photo.user.links.html });
        if (wordId) { await db.updateImageUrl(wordId, imgUrl, token); setWords(prev => prev.map(w => w.id === wordId ? { ...w, imageUrl: imgUrl } : w)); }
      }
    } catch (e) { setWordImage(null); }
    setImageLoading(false);
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

  const generateCombined = async () => {
    const sel = words.filter(w => selectedIds.includes(w.id));
    if (sel.length < 2) return;
    setCombineLoading(true); setCombineResult(null);
    try {
      const wordList = sel.map(w => w.word).join(", ");
      const res = await fetch("/api/claude", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 400, messages: [{ role: "user", content: `Write 3 natural English sentences that ALL use these words together: ${wordList}\nEach sentence must contain ALL the listed words. B1-B2 level.\nReply ONLY JSON array:\n[{"en":"sentence 1","sr":"srpski prevod"},{"en":"sentence 2","sr":"srpski prevod"},{"en":"sentence 3","sr":"srpski prevod"}]` }] })
      });
      const data = await res.json();
      const text = data.content?.find(b => b.type === "text")?.text || "";
      setCombineResult({ words: sel.map(w => w.word), sentences: JSON.parse(text.replace(/```json|```/g, "").trim()) });
    } catch (e) { showToast("Greška, pokušaj ponovo", "#ef4444"); }
    setCombineLoading(false);
  };

  const exportPDF = () => {
    const filterLabel = { all: "Sve reči", new: "Novo", learning: "Učim", known: "Znam" }[filter];
    const html = `<style>body{font-family:Georgia,serif;color:#111;padding:40px;max-width:800px;margin:0 auto}h1{font-size:28px;margin-bottom:4px}.subtitle{color:#888;font-size:13px;margin-bottom:32px}.word-block{border:1px solid #ddd;border-radius:10px;padding:20px;margin-bottom:20px;page-break-inside:avoid}.word{font-size:22px;font-style:italic;font-weight:700;margin-bottom:4px}.translation{font-size:16px;color:#333;margin-bottom:4px}.pos{font-size:11px;color:#999;font-family:monospace;margin-bottom:12px}.section-label{font-size:10px;letter-spacing:2px;color:#6366f1;text-transform:uppercase;margin-bottom:6px;margin-top:10px}.synonyms{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}.syn-tag{background:#f0f0ff;border:1px solid #c7d2fe;color:#4338ca;padding:2px 10px;border-radius:20px;font-size:12px;font-style:italic}.sentence{border-left:3px solid #6366f1;padding:8px 12px;margin-bottom:8px;background:#f8f8ff;border-radius:0 6px 6px 0}.sentence-en{font-size:13px;margin-bottom:2px}.sentence-sr{font-size:12px;color:#666;font-style:italic}.notes{font-size:12px;color:#888;font-style:italic;border-top:1px solid #eee;padding-top:8px;margin-top:8px}.meta{font-size:10px;color:#bbb;font-family:monospace;margin-top:8px}.status-new{border-left:4px solid #3b82f6}.status-learning{border-left:4px solid #f59e0b}.status-known{border-left:4px solid #22c55e}@media print{body{padding:20px}}</style><h1>Vokabular Tracker</h1><div class="subtitle">Export: ${filterLabel} · ${filteredWords.length} reči · ${new Date().toLocaleDateString("sr-RS")}</div>${filteredWords.map(w => `<div class="word-block status-${w.status}"><div class="word">${w.word}</div><div class="translation">${w.wordSr || w.translation || ""}</div>${w.partOfSpeech ? `<div class="pos">${w.partOfSpeech}</div>` : ""}${w.synonyms?.length ? `<div class="section-label">Sinonimi</div><div class="synonyms">${w.synonyms.map(s => `<span class="syn-tag">${s}</span>`).join("")}</div>` : ""}${w.sentences?.length ? `<div class="section-label">Primeri</div>${w.sentences.map(s => `<div class="sentence"><div class="sentence-en">${s.en || s}</div>${s.sr ? `<div class="sentence-sr">↳ ${s.sr}</div>` : ""}</div>`).join("")}` : ""}${w.notes ? `<div class="notes">📝 ${w.notes}</div>` : ""}<div class="meta">Dodano: ${formatDate(w.addedAt)}${w.learnedAt ? ` · Naučeno: ${formatDate(w.learnedAt)}` : ""}</div></div>`).join("")}`;
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:9999;background:#fff;";
    document.body.appendChild(iframe);
    iframe.contentDocument.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`);
    iframe.contentDocument.close();
    setTimeout(() => { iframe.contentWindow.focus(); iframe.contentWindow.print(); iframe.contentWindow.onafterprint = () => document.body.removeChild(iframe); }, 600);
  };

  const handleAuth = async () => {
    if (!authEmail || !authPassword) { setAuthError("Upiši email i lozinku."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authEmail)) { setAuthError("Upiši ispravnu email adresu."); return; }
    if (authPassword.length < 6) { setAuthError("Lozinka mora imati najmanje 6 karaktera."); return; }
    setAuthLoading(true); setAuthError(null);
    try {
      const data = authView === "login"
        ? await supabaseAuth.signIn(authEmail, authPassword)
        : await supabaseAuth.signUp(authEmail, authPassword);
      if (data.error || data.error_code) {
        const msg = data.error_description || data.msg || data.error || "Greška pri prijavi.";
        if (msg.includes("Invalid login")) setAuthError("Pogrešan email ili lozinka.");
        else if (msg.includes("already registered")) setAuthError("Email je već registrovan. Prijavi se.");
        else if (msg.includes("confirm")) setAuthError("Potvrdi email adresu pre prijave.");
        else setAuthError(msg);
      } else if (authView === "register" && !data.access_token) {
        setAuthError("Registracija uspješna! Provjeri email i potvrdi nalog, zatim se prijavi.");
      } else if (data.access_token) {
        localStorage.setItem("sb_token", data.access_token);
        setToken(data.access_token);
        setUser(data.user);
        const rows = await db.getAll(data.access_token);
        if (Array.isArray(rows)) setWords(rows.map(normalize));
      }
    } catch (e) { setAuthError("Greška pri povezivanju. Pokušaj ponovo."); }
    setAuthLoading(false);
  };

  const startPractice = (mode) => {
    if (mode === "smart" && !srsReady) {
      showToast(srsError || "Prvo aktiviraj Smart Learning SQL migraciju.", "#e11d48");
      return;
    }
    setPracticeMode(mode);
    setSessionReviewed([]);
    setReviewIndex(0);
    setRevealed(false);
    setView("review");
  };
  const practiceAdvance = () => {
    if (practiceMode === "smart" && currentReview) {
      // Preskočena reč se sklanja samo iz ove sesije; ostaje dospela za kasnije.
      setSessionReviewed(prev => [...prev, String(currentReview.id)]);
      setReviewIndex(0);
    } else {
      setReviewIndex(i => reviewWords.length ? (i + 1) % reviewWords.length : 0);
    }
    setRevealed(false);
  };
  const practiceRate = async (rating) => {
    if (!currentReview || srsSaving) return;
    const id = String(currentReview.id);
    if (practiceMode === "free") {
      setPracticeAnswers(prev => ({ ...prev, [id]: rating }));
      practiceAdvance();
      return;
    }
    if (!srsReady) return;
    setSrsSaving(true);
    try {
      const requestId = crypto.randomUUID();
      const result = await smartDb.rate(token, id, rating === "known" ? "good" : rating, requestId);
      setSrsSchedules(prev => ({ ...prev, [id]: result.schedule }));
      setSrsHistory(prev => [{ word_id: id, rating: result.rating, reviewed_at: result.reviewed_at }, ...prev]);
      setSessionReviewed(prev => [...prev, id]);
      setReviewIndex(0);
      setPracticeAnswers(prev => ({ ...prev, [id]: rating }));
      setRevealed(false);
    } catch (error) {
      showToast(error.message || "Greška pri čuvanju odgovora.", "#e11d48");
    } finally { setSrsSaving(false); }
  };

  if (loading) return <div style={{ minHeight: "100vh", background: "var(--v-bg)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--v-accent)", fontFamily: "monospace", letterSpacing: 3 }}>UČITAVANJE BAZE...</div>;
  if (dbError) return <div style={{ minHeight: "100vh", background: "var(--v-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}><div style={{ background: "var(--v-dangerBg)", border: "1px solid var(--v-dangerBorder)", borderRadius: 16, padding: 32, color: "#ef4444", fontFamily: "monospace", maxWidth: 400, textAlign: "center" }}><div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div><div>{dbError}</div></div></div>;

  if (emailConfirmed) return (
    <div style={{ minHeight: "100vh", background: "var(--v-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "var(--v-panel)", border: "1px solid #22c55e44", borderRadius: 20, padding: 48, width: "100%", maxWidth: 420, textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: 20 }}>✅</div>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "var(--v-accent)", marginBottom: 12, textTransform: "uppercase" }}>Vokabular Tracker</div>
        <h2 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: "normal", color: "var(--v-text)" }}>Email uspešno potvrđen!</h2>
        <p style={{ color: "var(--v-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>Tvoj nalog je aktiviran i spreman za korišćenje.<br />Možeš se sada prijaviti u sistem.</p>
        <button onClick={() => setEmailConfirmed(false)} style={{ background: "var(--v-accent)", border: "none", color: "var(--v-accentText)", padding: "14px 40px", borderRadius: 10, cursor: "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 1 }}>PRIJAVI SE →</button>
      </div>
    </div>
  );

  if (!user) return (
    <div style={{ minHeight: "100vh", background: "var(--v-bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "var(--v-panel)", border: "1px solid var(--v-border)", borderRadius: 20, padding: 40, width: "100%", maxWidth: 400 }}>
        <div style={{ fontSize: 11, letterSpacing: 4, color: "var(--v-accent)", marginBottom: 8, textTransform: "uppercase" }}>Vokabular Tracker</div>
        <h1 style={{ margin: "0 0 32px", fontSize: 24, fontWeight: "normal" }}>{authView === "login" ? "Prijava" : "Registracija"}</h1>
        {authError && <div style={{ background: "var(--v-dangerBg)", border: "1px solid var(--v-dangerBorder)", borderRadius: 8, padding: "10px 14px", color: "#ef4444", fontSize: 13, marginBottom: 16 }}>{authError}</div>}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Email</label>
          <input type="email" value={authEmail} onChange={e => setAuthEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAuth()} placeholder="vas@email.com"
            style={{ width: "100%", background: "var(--v-input)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "11px 14px", borderRadius: 8, fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box" }} />
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Lozinka</label>
          <input type="password" value={authPassword} onChange={e => setAuthPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleAuth()} placeholder="••••••••"
            style={{ width: "100%", background: "var(--v-input)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "11px 14px", borderRadius: 8, fontSize: 15, fontFamily: "Georgia, serif", boxSizing: "border-box" }} />
        </div>
        <button onClick={handleAuth} disabled={authLoading}
          style={{ width: "100%", background: authLoading ? "var(--v-elevated)" : "var(--v-accent)", border: "none", color: "#fff", padding: "14px", borderRadius: 10, cursor: authLoading ? "default" : "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 1, marginBottom: 16 }}>
          {authLoading ? "ČEKAJ..." : authView === "login" ? "PRIJAVI SE" : "REGISTRUJ SE"}
        </button>
        <div style={{ textAlign: "center", fontSize: 13, color: "var(--v-muted)" }}>
          {authView === "login" ? "Nemaš nalog?" : "Već imaš nalog?"}
          <button onClick={() => { setAuthView(authView === "login" ? "register" : "login"); setAuthError(null); }}
            style={{ background: "none", border: "none", color: "var(--v-accent)", cursor: "pointer", fontSize: 13, marginLeft: 6, textDecoration: "underline" }}>
            {authView === "login" ? "Registruj se" : "Prijavi se"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--v-bg)", fontFamily: "Georgia, serif", color: "var(--v-text)" }} onClick={() => { setPopup(null); setThemeMenuOpen(false); }}> 
      {popup && (
        <div style={{ position: "fixed", left: Math.min(Math.max(popup.x - 80, 8), window.innerWidth - 200), top: Math.min(popup.y + 8, window.innerHeight - 80), zIndex: 9999, background: "var(--v-panel)", border: "1px solid var(--v-accent)", borderRadius: 12, padding: "10px 16px", boxShadow: "0 8px 32px rgba(0,0,0,0.7)", display: "flex", alignItems: "center", gap: 12, whiteSpace: "nowrap", maxWidth: "90vw" }}>
          <span style={{ fontSize: 13, color: "var(--v-accentSoft)", fontStyle: "italic", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>"{popup.word}"</span>
          <button onClick={() => handleQuickAdd(popup.word)} style={{ background: "var(--v-accent)", border: "none", color: "var(--v-accentText)", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontFamily: "monospace" }}>+ Dodaj</button>
          <button onClick={() => setPopup(null)} style={{ background: "none", border: "none", color: "var(--v-muted)", cursor: "pointer", fontSize: 18, padding: "0 4px" }}>✕</button>
        </div>
      )}

      {quickAdding && (
        <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, background: "var(--v-accent)", color: "#fff", padding: "12px 20px", borderRadius: 10, fontFamily: "monospace", fontSize: 13, boxShadow: "0 4px 20px rgba(99,102,241,0.4)" }}>⟳ Dodajem u rečnik...</div>
      )}
      {toast && <div style={{ position: "fixed", top: 20, right: 20, zIndex: 999, background: toast.color, color: "#fff", padding: "10px 20px", borderRadius: 8, fontFamily: "monospace", fontSize: 14, boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>{toast.msg}</div>}

      {/* HEADER */}
      <div style={{ background: "var(--v-header)", borderBottom: "1px solid var(--v-border)", padding: "22px 24px 20px" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 4, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Vokabular Tracker</div>
              <h1 style={{ margin: 0, fontSize: 26, fontWeight: "normal", letterSpacing: -0.5 }}>Moj engleski</h1>
              <div style={{ fontSize: 10, color: "var(--v-subtle)", fontFamily: "monospace", marginTop: 4 }}>● Supabase Cloud</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <div style={{ fontSize: 11, color: "var(--v-muted)", fontFamily: "monospace" }}>{user.email}</div>
              <div style={{ position: "relative", zIndex: 30 }}>
                <button type="button" onClick={e => { e.stopPropagation(); setThemeMenuOpen(v => !v); }}
                  aria-label="Promeni temu" aria-expanded={themeMenuOpen} title="Izaberi temu"
                  style={{ background: "var(--v-elevated)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "7px 11px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>
                  🎨 {theme.name} ▾
                </button>
                {themeMenuOpen && (
                  <div onClick={e => e.stopPropagation()} style={{ position: "absolute", right: 0, top: "calc(100% + 8px)", width: 245, maxWidth: "85vw", background: "var(--v-panel)", border: "1px solid var(--v-border)", borderRadius: 12, padding: 8, boxShadow: "0 16px 40px rgba(0,0,0,0.22)", zIndex: 1000 }}>
                    <div style={{ padding: "6px 8px 10px", color: "var(--v-muted)", fontFamily: "monospace", fontSize: 11 }}>IZABERI TEMU</div>
                    {VOCAB_THEME_IDS.map(id => {
                      const item = VOCAB_THEMES[id];
                      return (
                        <button key={id} type="button" onClick={() => chooseTheme(id)}
                          style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", border: id === themeId ? "1px solid var(--v-accent)" : "1px solid transparent", borderRadius: 8, padding: "8px", marginBottom: 3, textAlign: "left", background: id === themeId ? "var(--v-elevated)" : "transparent", cursor: "pointer", color: "var(--v-text)" }}>
                          <span style={{ display: "flex", gap: 2, padding: 4, border: `1px solid ${item.colors.border}`, background: item.colors.bg, borderRadius: 6 }}>
                            {[item.colors.card, item.colors.accent, item.colors.text].map((color, i) => <span key={i} style={{ width: 10, height: 22, background: color, borderRadius: 3 }} />)}
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 12, fontWeight: 700 }}>{item.name}</span>
                            <span style={{ display: "block", fontSize: 10, color: "var(--v-muted)", marginTop: 2 }}>{item.description}</span>
                          </span>
                          {id === themeId && <span style={{ color: "var(--v-accentSoft)" }}>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button onClick={() => { supabaseAuth.signOut(token); localStorage.removeItem("sb_token"); setUser(null); setToken(null); setWords([]); }} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>odjavi se</button>
            </div>
          </div>
          <div className="vocab-topnav" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {[["home", "⌂  Početna"], ["dictionary", "▤  Rečnik"]].map(([id, label]) => (
              <button key={id} onClick={() => { setWorkspaceTab(id); setView("list"); setCombineMode(false); }}
                style={{ border: "1px solid " + ((view === "list" && workspaceTab === id) ? "var(--v-accent)" : "var(--v-border)"), background: (view === "list" && workspaceTab === id) ? "var(--v-accent)" : "var(--v-panel)", color: (view === "list" && workspaceTab === id) ? "var(--v-accentText)" : "var(--v-text)", padding: "10px 17px", borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>
                {label}
              </button>
            ))}
            <button onClick={() => startPractice(srsReady ? "smart" : "free")} disabled={words.length === 0}
              style={{ border: "1px solid " + (view === "review" ? "var(--v-accent)" : "var(--v-border)"), background: view === "review" ? "var(--v-accent)" : "var(--v-panel)", color: view === "review" ? "var(--v-accentText)" : "var(--v-text)", padding: "10px 17px", borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 13, opacity: words.length ? 1 : 0.5 }}>
              ◎  Vežbanje
            </button>
            <button onClick={() => { setWorkspaceTab("dictionary"); setView("add"); setWordInput(""); setAiData(null); setNotes(""); }}
              style={{ marginLeft: "auto", background: "var(--v-accent)", color: "var(--v-accentText)", border: "none", borderRadius: 10, padding: "10px 17px", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
              + Dodaj reč
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["all", "new", "learning", "known"].map(s => (
              <button key={s} onClick={() => { setFilter(s); setWorkspaceTab("dictionary"); setView("list"); }} style={{ background: filter === s ? "var(--v-accent)" : "rgba(255,255,255,0.05)", border: "1px solid " + (filter === s ? "var(--v-accent)" : "var(--v-border)"), color: filter === s ? "var(--v-accentText)" : "var(--v-muted)", padding: "6px 12px", borderRadius: 20, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>
                {s === "all" ? "Sve" : statusLabel(s)} ({counts[s]})
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ADD VIEW */}
      {view === "add" && (
        <div style={{ padding: 24, maxWidth: 760, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <button onClick={() => setView("list")} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>← Nazad</button>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: "normal" }}>Nova Reč</h2>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Upiši reč ili frazu (srpski ili engleski)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={wordInput} onChange={e => handleWordInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && wordInput.trim().length >= 2) lookupWord(wordInput); }} placeholder="npr. equity, take for granted, prinos..." autoFocus style={{ ...inp, flex: 1, fontSize: 18, fontStyle: "italic", padding: "14px 16px" }} />
              <button onClick={() => lookupWord(wordInput)} disabled={wordInput.trim().length < 2 || aiLoading} style={{ background: wordInput.trim().length >= 2 ? "var(--v-accent)" : "var(--v-panel)", border: "1px solid " + (wordInput.trim().length >= 2 ? "var(--v-accent)" : "var(--v-border)"), color: wordInput.trim().length >= 2 ? "#fff" : "var(--v-subtle)", padding: "0 20px", borderRadius: 8, cursor: wordInput.trim().length >= 2 ? "pointer" : "default", fontSize: 18, transition: "all 0.15s", flexShrink: 0 }}>{aiLoading ? "⟳" : "→"}</button>
            </div>
          </div>
          {aiLoading && <div style={{ background: "var(--v-panel)", borderRadius: 12, padding: 24, border: "1px solid var(--v-border)", marginBottom: 20, textAlign: "center", color: "var(--v-accent)", fontFamily: "monospace", fontSize: 13, letterSpacing: 2 }}>TRAŽIM...</div>}
          {aiError && <div style={{ background: "var(--v-dangerBg)", border: "1px solid var(--v-dangerBorder)", borderRadius: 12, padding: 16, marginBottom: 20, color: "#ef4444", fontSize: 13 }}>{aiError}</div>}
          {aiData && !aiLoading && (
            <div style={{ background: "var(--v-panel)", borderRadius: 16, padding: 24, border: "1px solid var(--v-accent)", marginBottom: 20 }}>
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Prevod</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ fontSize: 22, color: "var(--v-text)" }}>{wordInput.trim().toLowerCase() === aiData.wordSr?.toLowerCase() ? aiData.wordEn : aiData.wordSr}</div>
                  <button onClick={() => speak(aiData.wordEn || wordInput)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, padding: 4, lineHeight: 1, opacity: 0.7 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.7}>🔊</button>
                </div>
                {aiData.ipa && <div style={{ fontSize: 13, color: "var(--v-accent)", fontFamily: "monospace", marginTop: 3, letterSpacing: 1 }}>{aiData.ipa}</div>}
                {aiData.partOfSpeech && <div style={{ fontSize: 12, color: "var(--v-muted)", fontFamily: "monospace", marginTop: 4 }}>{aiData.partOfSpeech}</div>}
              </div>
              {aiData.synonyms?.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 8, textTransform: "uppercase" }}>Sinonimi</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {aiData.synonyms.map((syn, i) => (
                      <span key={i} onClick={e => { e.stopPropagation(); const rect = e.target.getBoundingClientRect(); setPopup({ word: syn, x: rect.left + rect.width / 2, y: rect.bottom + 8 }); }} style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "var(--v-accentSoft)", padding: "4px 12px", borderRadius: 20, fontSize: 13, fontStyle: "italic", cursor: "pointer" }} onMouseEnter={e => { e.target.style.background = "rgba(99,102,241,0.3)"; e.target.style.borderColor = "var(--v-accent)"; }} onMouseLeave={e => { e.target.style.background = "rgba(99,102,241,0.12)"; e.target.style.borderColor = "rgba(99,102,241,0.3)"; }}>{syn}</span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", textTransform: "uppercase" }}>Primeri</div>
                  <button onClick={() => regenerateSentences(wordInput, (updater) => setAiData(prev => ({ ...prev, sentences: typeof updater === "function" ? updater(prev.sentences) : updater })), aiData.sentences)} disabled={regenLoading} style={{ background: "none", border: "1px solid var(--v-accent)", color: regenLoading ? "var(--v-subtle)" : "var(--v-accentSoft)", padding: "4px 10px", borderRadius: 6, cursor: regenLoading ? "default" : "pointer", fontSize: 11, fontFamily: "monospace" }}>{regenLoading ? "..." : "+ dodaj primer"}</button>
                </div>
                {aiData.sentences?.map((s, i) => <SentenceCard key={i} s={s} i={i} word={wordInput} onDelete={idx => setAiData(prev => ({ ...prev, sentences: prev.sentences.filter((_, j) => j !== idx) }))} onUpdate={(idx, updated) => setAiData(prev => ({ ...prev, sentences: prev.sentences.map((x, j) => j === idx ? updated : x) }))} />)}
              </div>
            </div>
          )}
          {aiData && !aiLoading && <div style={{ marginBottom: 20 }}><label style={{ display: "block", fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Tvoje beleške (opcionalno)</label><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="npr. viđeno u Bloomberg članku o ETF-ima..." rows={2} style={{ ...inp, resize: "vertical", fontFamily: "Georgia, serif" }} /></div>}
          {aiData && !aiLoading && <div style={{ height: 80 }} />}
        </div>
      )}

      {view === "add" && aiData && !aiLoading && (
        <button onClick={addWord} style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", background: "var(--v-action)", border: "none", color: "#fff", padding: "14px 36px", borderRadius: 50, cursor: "pointer", fontSize: 15, fontFamily: "monospace", letterSpacing: 2, boxShadow: "0 4px 24px rgba(217,119,6,0.5)", zIndex: 100, whiteSpace: "nowrap" }}>
          {saving ? "ČUVAM..." : "SAČUVAJ U BAZU →"}
        </button>
      )}

      {/* DETAIL VIEW */}
      {view === "detail" && selected && (
        <div style={{ padding: 24, maxWidth: 760, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
            <button onClick={() => { setView("list"); setWordImage(null); }} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>← Nazad</button>
          </div>
          <div style={{ background: "var(--v-panel)", borderRadius: 16, padding: 28, border: "1px solid " + (selected.status === "known" ? "#22c55e44" : selected.status === "learning" ? "#e11d4844" : "var(--v-border)"), transition: "background 0.4s, border-color 0.4s" }}>
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 28, fontWeight: "normal", fontStyle: "italic", wordBreak: "break-word" }}>{selected.word}</h2>
                {selected.ipa && <span style={{ fontSize: 13, color: "var(--v-accent)", fontFamily: "monospace", letterSpacing: 1 }}>{selected.ipa}</span>}
                <button onClick={() => speak(selected.word)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, padding: 4, lineHeight: 1, opacity: 0.7 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.7}>🔊</button>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {[["★","new","#3b82f6","Novo"],["?","learning","#e11d48","Učim"],["✓","known","#22c55e","Znam"]].map(([label, s, color, tip]) => (
                  <div key={s} style={{ position: "relative" }}>
                    <button onClick={() => { updateStatus(selected.id, s); setSelected(prev => ({ ...prev, status: s })); showToast("Status ažuriran"); }} style={{ background: selected.status === s ? color : "transparent", border: "1px solid " + (selected.status === s ? color : "rgba(255,255,255,0.2)"), color: selected.status === s ? "#fff" : "rgba(255,255,255,0.25)", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }} onMouseEnter={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }} onMouseLeave={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}>{label}</button>
                    <div className="tip" style={{ position: "absolute", bottom: 38, left: "50%", transform: "translateX(-50%)", background: "var(--v-panel)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>{tip}</div>
                  </div>
                ))}
                <div style={{ position: "relative" }}>
                  <button onClick={() => deleteWord(selected.id)} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "var(--v-statusInactive)", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }} onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "var(--v-text)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--v-statusInactive)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}>✕</button>
                  <div className="tip" style={{ position: "absolute", bottom: 38, left: "50%", transform: "translateX(-50%)", background: "var(--v-panel)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>Briši</div>
                </div>
                <span style={{ marginLeft: "auto", background: "rgba(99,102,241,0.15)", color: selected.status === "new" ? "#3b82f6" : selected.status === "learning" ? "#e11d48" : "#22c55e", padding: "4px 12px", borderRadius: 20, fontSize: 11, fontFamily: "monospace" }}>{selected.status === "new" ? "Novo" : selected.status === "learning" ? "Učim" : "Znam"}</span>
              </div>
            </div>
            {imageLoading && <div style={{ height: 160, background: "rgba(255,255,255,0.03)", borderRadius: 10, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--v-subtle)", fontFamily: "monospace", fontSize: 12 }}>učitavam sliku...</div>}
            {wordImage && !imageLoading && (
              <div style={{ marginBottom: 16, borderRadius: 10, overflow: "hidden", position: "relative" }}>
                <img src={wordImage.url} alt={selected.word} onError={e => { e.target.parentNode.style.display = "none"; }} style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }} />
                {wordImage.author && <a href={`${wordImage.authorUrl}?utm_source=vokabular_tracker&utm_medium=referral`} target="_blank" rel="noreferrer" style={{ position: "absolute", bottom: 6, right: 8, fontSize: 10, color: "var(--v-muted)", textDecoration: "none", background: "rgba(0,0,0,0.4)", padding: "2px 6px", borderRadius: 4 }}>Photo by {wordImage.author} on Unsplash</a>}
              </div>
            )}
            {selected.translation && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 6, textTransform: "uppercase" }}>Prevod</div>
                {editingTranslation ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input value={editTranslationVal} onChange={e => setEditTranslationVal(e.target.value)} autoFocus style={{ flex: 1, background: "var(--v-input)", border: "1px solid var(--v-accent)", color: "var(--v-text)", padding: "8px 12px", borderRadius: 8, fontSize: 18, fontFamily: "Georgia, serif" }} />
                    <button onClick={async () => { await db.updateTranslation(selected.id, editTranslationVal, token); setWords(prev => prev.map(w => w.id === selected.id ? { ...w, wordSr: editTranslationVal, translation: editTranslationVal } : w)); setSelected(prev => ({ ...prev, wordSr: editTranslationVal, translation: editTranslationVal })); setEditingTranslation(false); showToast("Prevod ažuriran ✓"); }} style={{ background: "#22c55e", border: "none", color: "#fff", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontFamily: "monospace" }}>✓</button>
                    <button onClick={() => setEditingTranslation(false)} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "8px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ fontSize: 20, color: "#c9c0b4" }}>{selected.wordSr || selected.translation}</div>
                    <button onClick={() => { setEditTranslationVal(selected.wordSr || selected.translation); setEditingTranslation(true); }} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "monospace" }}>✎ edit</button>
                  </div>
                )}
                {selected.partOfSpeech && <div style={{ fontSize: 11, color: "var(--v-muted)", fontFamily: "monospace", marginTop: 4 }}>{selected.partOfSpeech}</div>}
              </div>
            )}
            {selected.synonyms?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 8, textTransform: "uppercase" }}>Sinonimi</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {selected.synonyms.map((syn, i) => (
                    <span key={i} onClick={e => { e.stopPropagation(); const rect = e.target.getBoundingClientRect(); setPopup({ word: syn, x: rect.left + rect.width / 2, y: rect.bottom + 8 }); }} style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.3)", color: "var(--v-accentSoft)", padding: "4px 12px", borderRadius: 20, fontSize: 13, fontStyle: "italic", cursor: "pointer" }} onMouseEnter={e => { e.target.style.background = "rgba(99,102,241,0.3)"; e.target.style.borderColor = "var(--v-accent)"; }} onMouseLeave={e => { e.target.style.background = "rgba(99,102,241,0.12)"; e.target.style.borderColor = "rgba(99,102,241,0.3)"; }}>{syn}</span>
                  ))}
                </div>
              </div>
            )}
            {selected.sentences?.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", textTransform: "uppercase" }}>Primeri</div>
                  <button onClick={() => regenerateSentences(selected.word, (updater) => { const newList = typeof updater === "function" ? updater(selected.sentences) : updater; setWords(prev => prev.map(w => w.id === selected.id ? { ...w, sentences: newList } : w)); setSelected(prev => ({ ...prev, sentences: newList })); }, selected.sentences)} disabled={regenLoading} style={{ background: "none", border: "1px solid var(--v-accent)", color: regenLoading ? "var(--v-subtle)" : "var(--v-accentSoft)", padding: "4px 10px", borderRadius: 6, cursor: regenLoading ? "default" : "pointer", fontSize: 11, fontFamily: "monospace" }}>{regenLoading ? "..." : "+ dodaj primer"}</button>
                </div>
                {selected.sentences.map((s, i) => <SentenceCard key={i} s={s} i={i} word={selected.word} onDelete={idx => { const updated = selected.sentences.filter((_, j) => j !== idx); setWords(prev => prev.map(w => w.id === selected.id ? { ...w, sentences: updated } : w)); setSelected(prev => ({ ...prev, sentences: updated })); }} onUpdate={(idx, updatedS) => { const updated = selected.sentences.map((x, j) => j === idx ? updatedS : x); setWords(prev => prev.map(w => w.id === selected.id ? { ...w, sentences: updated } : w)); setSelected(prev => ({ ...prev, sentences: updated })); }} />)}
              </div>
            )}
            {selected.notes && <div style={{ marginBottom: 16 }}><div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 4, textTransform: "uppercase" }}>Beleške</div><div style={{ fontSize: 13, color: "var(--v-muted)" }}>{selected.notes}</div></div>}
            <div style={{ fontSize: 11, color: "var(--v-subtle)", fontFamily: "monospace" }}>
              Dodano: {formatDate(selected.addedAt)} · Ponovljeno: {selected.reviewCount}x
              {selected.learnedAt && <span style={{ color: "#22c55e" }}> · Naučeno: {formatDate(selected.learnedAt)}</span>}
            </div>
          </div>
        </div>
      )}

      {/* PRACTICE — v5.1 screenshot-inspired responsive dashboard */}
      {view === "review" && (
        <main className="vocab-practice-page" style={{ maxWidth: 1530, margin: "0 auto", padding: "22px 18px 56px", boxSizing: "border-box" }}>
          <div className="v51-modes">
            <div className="v51-mode-buttons">
              <button onClick={() => startPractice("smart")} disabled={!srsReady} className={`v51-mode ${practiceMode === "smart" ? "active" : ""}`} style={{ opacity: srsReady ? 1 : .5 }}>♧ &nbsp; Pametno ponavljanje ({srsReady ? dueWords.length : "—"})</button>
              <button onClick={() => startPractice("free")} className={`v51-mode ${practiceMode === "free" ? "active" : ""}`}>⤨ &nbsp; Slobodno vežbanje ({words.length})</button>
            </div>
            <div className="v51-goal-controls">
              <label htmlFor="v51-daily-goal">◎ &nbsp; Dnevni cilj:</label>
              <select id="v51-daily-goal" value={dayGoal} onChange={e => { const n = Number(e.target.value); setDayGoal(n); localStorage.setItem("vocab_daily_goal", String(n)); }}>
                {[10,15,20,30,50].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <div className="v51-top-progress"><span style={{ width: `${Math.min(100, todaysReviews.length / dayGoal * 100)}%` }} /></div>
              <strong>{todaysReviews.length} / {dayGoal} ({Math.min(100, Math.round(todaysReviews.length / dayGoal * 100))}%)</strong>
            </div>
          </div>
          {srsError && <div role="alert" style={{ border: "1px solid var(--v-dangerBorder)", background: "var(--v-dangerBg)", borderRadius: 12, padding: 14, marginBottom: 20 }}>Smart Learning još nije aktivan: {srsError}. Slobodno vežbanje je dostupno.</div>}
          <div className="v51-practice-grid">
            <aside className="v51-pane v51-left">
              <div className="v51-pane-title"><span className="v51-icon">▦</span><span><b>Današnje vežbanje</b><small>Reči koje je vreme da ponoviš</small></span></div>
              {[
                ["↻", "Za ponavljanje danas", srsReady ? dueWords.length : "—", "blue"],
                ["✓", "Odrađeno danas", srsReady ? todaysReviews.length : "—", "green"],
                ["◎", "Dnevni cilj", dayGoal, "purple"]
              ].map(([icon,label,value,color]) => <div className="v51-stat" key={label}><span className={`v51-stat-icon ${color}`}>{icon}</span><span><small>{label}</small><strong>{value}</strong></span></div>)}
              <div className="v51-progress-section">
                <div className="v51-progress-head"><b>Napredak danas</b><strong>{Math.min(100, Math.round(todaysReviews.length / dayGoal * 100))}%</strong></div>
                <div className="v51-progress-bar"><span style={{ width: `${Math.min(100, todaysReviews.length / dayGoal * 100)}%` }} /></div>
              </div>
              <div className="v51-next-date"><span className="v51-icon">▦</span><span><b>Sledeće ponavljanje</b><small>{(() => { const dates = Object.values(srsSchedules).map(s => s.due_at && new Date(s.due_at).getTime()).filter(n => Number.isFinite(n) && n > Date.now()).sort((a,b) => a-b); return !srsReady ? "Aktiviraj Smart Learning" : dates.length ? new Date(dates[0]).toLocaleDateString("sr-RS", {day:"numeric",month:"short"}) : "Nema zakazanih reči"; })()}</small></span></div>
            </aside>
            <section className="v51-middle">
              {!currentReview ? (
                <div className="v51-flashcard v51-finished"><div className="v51-finished-emoji">🎉</div><h2>Sesija završena!</h2><p>{practiceMode === "smart" ? "Sve trenutno dospele reči su obrađene ili preskočene u ovoj sesiji. Preskočene reči ostaju dospele." : "Nema reči u rečniku."}</p><button className="v51-primary" onClick={() => startPractice(practiceMode)}>Nova sesija</button><button className="v51-outline" onClick={() => {setWorkspaceTab("dictionary");setView("list");}}>Otvori rečnik</button></div>
              ) : (
                <div className="v51-flashcard">
                  <div className="v51-card-top"><span className="v51-counter">{practiceMode === "smart" ? sessionReviewed.length + 1 : reviewIndex + 1} / {practiceMode === "smart" ? sessionReviewed.length + reviewWords.length : reviewWords.length}</span><span className="v51-card-mode">{practiceMode === "smart" ? "Pametno ponavljanje" : "Slobodno vežbanje"}</span><span title={`Status: ${statusLabel(currentReview.status)}`} className="v51-star">☆</span></div>
                  <div className="v51-word"><div className="v51-word-line"><h2>{currentReview.word}</h2><button onClick={() => speak(currentReview.word)} className="v51-sound" aria-label="Izgovori reč" title="Izgovori reč">◖))</button></div>{currentReview.ipa && <div className="v51-ipa">{currentReview.ipa}</div>}</div>
                  {!revealed ? <div className="v51-question"><p>Kako se prevodi na srpski?</p><button className="v51-reveal" onClick={() => setRevealed(true)}>Prikaži odgovor</button></div> : <div className="v51-revealed"><div className="v51-answer">✓ &nbsp; {currentReview.wordSr || currentReview.translation || "Nema prevoda"}</div>{currentReview.sentences?.[0] && <div className="v51-example"><span>❞</span><div><strong>Primer:</strong><div className="v51-example-en">{currentReview.sentences[0].en || currentReview.sentences[0]}</div>{currentReview.sentences[0].sr && <small>{currentReview.sentences[0].sr}</small>}</div></div>}<div className="v51-rating-grid"><button onClick={() => practiceRate("again")} disabled={srsSaving} className="v51-rating bad"><b>✕ &nbsp; Ne znam</b><small>{practiceMode === "smart" ? "Ponovo za 10 min" : "Sledeća reč"}</small></button><button onClick={() => practiceRate("hard")} disabled={srsSaving} className="v51-rating hard"><b>▥ &nbsp; Teško</b><small>{practiceMode === "smart" ? "Ponovo za 1 dan" : "Sledeća reč"}</small></button><button onClick={() => practiceRate("known")} disabled={srsSaving} className="v51-rating good"><b>✓ &nbsp; Znam</b><small>{practiceMode === "smart" ? "Duži interval" : "Sledeća reč"}</small></button></div></div>}
                  <div className="v51-card-bottom"><button onClick={() => speak(currentReview.word)}>◖)) &nbsp; Izgovor</button><button onClick={practiceAdvance}>⏭ &nbsp; Preskoči</button><button onClick={() => { setPracticeShuffle(v => !v);setReviewIndex(0);setRevealed(false); }}>⤨ &nbsp; {practiceShuffle ? "Redom" : "Nasumično"}</button></div>
                </div>
              )}
              <div className="v51-below-card"><button onClick={() => { setReviewIndex(i => reviewWords.length ? (i - 1 + reviewWords.length) % reviewWords.length : 0); setRevealed(false); }} disabled={practiceMode === "smart" || reviewWords.length < 2}>← &nbsp; Prethodna</button><div className="v51-dots">{Array.from({length:Math.min(11,Math.max(1,reviewWords.length))},(_,i)=><i key={i} className={i === (reviewIndex % Math.max(1,reviewWords.length)) ? "on" : ""} />)}</div><button onClick={practiceAdvance} disabled={!currentReview}>Sledeća &nbsp; →</button></div>
            </section>
            <aside className="v51-pane v51-right">
              <div className="v51-pane-title"><span className="v51-icon">▱</span><span><b>Sledeće na redu</b><small>Narednih 5 reči za vežbanje</small></span></div>
              {reviewWords.length < 2 ? <p className="v51-empty">Trenutno nema narednih reči.</p> : Array.from({length:Math.min(5,reviewWords.length-1)},(_,i)=>{const idx=(reviewIndex+i+1)%reviewWords.length;const w=reviewWords[idx];return <button className="v51-queue-row" key={w.id} onClick={()=>{setReviewIndex(idx);setRevealed(false);}}><span className="v51-queue-num">{i+1}</span><span className="v51-queue-label"><b>{w.word}</b><small>{w.ipa || " "}</small></span><span className={`v51-status ${w.status}`}>{statusLabel(w.status)}</span></button>;})}
            </aside>
          </div>
          <div className="v51-explanation"><div><span className="v51-icon">♧</span><span><b>Smart Learning (SRS)</b><small>{practiceMode === "smart" ? "Aplikacija određuje naredno ponavljanje na osnovu tvojih odgovora." : "Slobodno vežbanje ne menja raspored, statuse ni istoriju u Supabase-u."}</small></span></div><div><b>Raspored ponavljanja:</b><span><em>✕ Ne znam – 10 min</em><em>◔ Teško – 1 dan</em><em>✓ Znam – sve duži intervali</em></span></div></div>
        </main>
      )}

      {/* LIST VIEW */}
      {view === "list" && (
        <div style={{ padding: 24, paddingBottom: 42, maxWidth: 1080, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          {workspaceTab === "home" && (
            <section style={{ marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <div>
                  <div style={{ color: "var(--v-accentSoft)", fontSize: 11, letterSpacing: 2, fontFamily: "monospace", textTransform: "uppercase", marginBottom: 6 }}>Tvoj prostor za učenje</div>
                  <h2 style={{ fontSize: 28, margin: 0, lineHeight: 1.2, fontWeight: 600 }}>Pregled napretka</h2>
                  <p style={{ margin: "8px 0 0", color: "var(--v-muted)", fontSize: 13 }}>Sve tvoje reči i vežbanje na jednom mestu.</p>
                </div>
                <button onClick={() => setWorkspaceTab("dictionary")} style={{ border: "1px solid var(--v-border)", background: "var(--v-panel)", color: "var(--v-text)", padding: "10px 14px", borderRadius: 10, cursor: "pointer", fontWeight: 600 }}>Otvori rečnik →</button>
              </div>
              <div className="vocab-stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginBottom: 14 }}>
                {[["Sve reči", counts.all, "var(--v-accent)"], ["Novo", counts.new, "#3b82f6"], ["Učim", counts.learning, "#e11d48"], ["Znam", counts.known, "#22a36a"]].map(([label, value, color]) => (
                  <div key={label} style={{ background: "var(--v-panel)", border: "1px solid var(--v-border)", borderRadius: 16, padding: "17px 18px", boxShadow: "0 3px 12px rgba(0,0,0,0.025)" }}>
                    <div style={{ fontSize: 12, color: "var(--v-muted)", marginBottom: 9 }}>{label}</div>
                    <div style={{ fontSize: 30, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
                  </div>
                ))}
              </div>
              <div className="vocab-hero-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.4fr) minmax(250px,1fr)", gap: 14 }}>
                <div style={{ background: "var(--v-panel)", border: "1px solid var(--v-border)", borderRadius: 17, padding: 22 }}>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "var(--v-accentSoft)", marginBottom: 12 }}>Vežbanje</div>
                  <h3 style={{ margin: "0 0 8px", fontSize: 21 }}>Ponovi naučeno</h3>
                  <p style={{ fontSize: 13, color: "var(--v-muted)", lineHeight: 1.5, margin: "0 0 20px" }}>{srsReady ? `Danas je dospelo ${dueWords.length} reči. Već imaš ${todaysReviews.length} ponavljanja, od cilja ${dayGoal}.` : "Aktiviraj Smart Learning SQL skriptom ili nastavi sa slobodnim vežbanjem."}</p>
                  <button disabled={!words.length} onClick={() => startPractice(srsReady ? "smart" : "free")}
                    style={{ background: "var(--v-accent)", color: "var(--v-accentText)", border: "none", padding: "12px 18px", borderRadius: 10, cursor: words.length ? "pointer" : "default", opacity: words.length ? 1 : 0.5, fontWeight: 700, fontSize: 13 }}>▶ {srsReady ? "Pametno ponavljanje" : "Slobodno vežbanje"}</button>
                </div>
                <div style={{ background: "var(--v-panel)", border: "1px solid var(--v-border)", borderRadius: 17, padding: 22 }}>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 2, color: "var(--v-accentSoft)", marginBottom: 12 }}>Napredak rečnika</div>
                  <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 10 }}>{counts.all ? Math.round(counts.known / counts.all * 100) : 0}% <span style={{ fontWeight: 400, fontSize: 13, color: "var(--v-muted)" }}>u statusu Znam</span></div>
                  <div style={{ height: 9, background: "var(--v-elevated)", overflow: "hidden", borderRadius: 20, marginBottom: 12 }}><div style={{ width: `${counts.all ? counts.known / counts.all * 100 : 0}%`, height: "100%", background: "#22a36a", borderRadius: 20 }} /></div>
                  <div style={{ color: "var(--v-muted)", fontSize: 12, lineHeight: 1.6 }}>Statusi reči ostaju ručni. {srsReady ? `Danas: ${todaysReviews.length} ocena · ${todayCorrect} puta „Znam“. Sledeći termin svake reči čuva se u Supabase-u.` : "Za istoriju i raspored uradi SQL migraciju."}</div>
                </div>
              </div>
            </section>
          )}
          {workspaceTab === "home" && (
            <section style={{ marginTop: 28 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                <div><h2 style={{ fontSize: 23, margin: "0 0 5px" }}>Poslednje dodate reči</h2><div style={{ fontSize: 13, color: "var(--v-muted)" }}>Brzi pregled, bez prikazivanja celog rečnika</div></div>
                <button onClick={() => setWorkspaceTab("dictionary")} style={{ border: "1px solid var(--v-border)", background: "var(--v-panel)", borderRadius: 9, color: "var(--v-text)", padding: "9px 13px", cursor: "pointer" }}>Sve reči →</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(235px,1fr))", gap: 10 }}>
                {[...words].sort((a,b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0)).slice(0,6).map(w => (
                  <button key={w.id} onClick={() => { setSelected(w); setView("detail"); fetchImage(w.word,w.imageUrl,w.id); }} style={{ background: "var(--v-panel)", color: "var(--v-text)", border: "1px solid var(--v-border)", borderLeft: `4px solid ${statusDot(w.status)}`, textAlign: "left", borderRadius: 12, padding: "14px 16px", cursor: "pointer" }}>
                    <div style={{ fontSize: 17, fontStyle: "italic", fontWeight: 700, marginBottom: 5 }}>{w.word}</div>
                    <div style={{ fontSize: 13, color: "var(--v-muted)" }}>{w.translation}</div>
                  </button>
                ))}
              </div>
            </section>
          )}
          {workspaceTab === "dictionary" && (<>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 22 }}>Moj rečnik</h2>
              <div style={{ color: "var(--v-muted)", fontSize: 12, marginTop: 4 }}>{filteredWords.length} prikazanih od ukupno {words.length} reči</div>
            </div>

          </div>
          {/* Actions bar */}
          <div className="vocab-toolbar" style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 18, flexWrap: "wrap", background: "var(--v-panel)", padding: 10, border: "1px solid var(--v-border)", borderRadius: 14 }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="⌕  Pretraži reči..." style={{ flex: "1 1 230px", minWidth: 150, background: "var(--v-input)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "11px 13px", borderRadius: 9, fontSize: 13, fontFamily: "Georgia, serif", boxSizing: "border-box" }} />
            <select value={sortOrder} onChange={e => { setSortOrder(e.target.value); localStorage.setItem("vocab_sort", e.target.value); }} aria-label="Sortiraj reči" title="Sortiraj reči"
              style={{ background: "var(--v-input)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "11px 12px", borderRadius: 9, cursor: "pointer", fontSize: 12, maxWidth: "100%" }}>
              <option value="newest">↓ Najnovije</option><option value="oldest">↑ Najstarije</option><option value="az">A–Z</option><option value="za">Z–A</option>
            </select>
            {filteredWords.length > 0 && <button onClick={exportPDF} title="Izvezi PDF" style={{ background: "var(--v-input)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "11px 13px", borderRadius: 9, cursor: "pointer", fontSize: 12 }}>↓ PDF</button>}
            <button onClick={() => { setCombineMode(!combineMode); setSelectedIds([]); setCombineResult(null); }} style={{ background: combineMode ? "var(--v-accent)" : "var(--v-input)", border: "1px solid var(--v-border)", color: combineMode ? "var(--v-accentText)" : "var(--v-text)", padding: "11px 13px", borderRadius: 9, cursor: "pointer", fontSize: 12 }}>⊕ Kombiniraj</button>
            <div style={{ display: "flex", background: "var(--v-input)", border: "1px solid var(--v-border)", borderRadius: 9, overflow: "hidden", marginLeft: "auto" }}>
              <button onClick={() => setLayoutView("list")} title="Lista" aria-label="Prikaži listu" style={{ background: layoutView === "list" ? "var(--v-elevated)" : "transparent", border: "none", color: "var(--v-text)", padding: "10px 12px", cursor: "pointer" }}>☰</button>
              <button onClick={() => setLayoutView("board")} title="Board" aria-label="Prikaži board" style={{ background: layoutView === "board" ? "var(--v-elevated)" : "transparent", border: "none", color: "var(--v-text)", padding: "10px 12px", cursor: "pointer" }}>⊞</button>
            </div>
          </div>

          {/* Combine result */}
          {combineResult && (
            <div style={{ background: "var(--v-panel)", border: "1px solid var(--v-accent)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 12, textTransform: "uppercase", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                Kombinovani primeri — {combineResult.words.map(w => <span key={w} style={{ background: "rgba(99,102,241,0.2)", padding: "2px 8px", borderRadius: 10, fontStyle: "italic", textTransform: "none", letterSpacing: 0 }}>{w}</span>)}
              </div>
              {combineResult.sentences.map((s, i) => (
                <div key={i} style={{ background: "rgba(99,102,241,0.07)", borderLeft: "2px solid var(--v-accent)", padding: "10px 14px", borderRadius: "0 8px 8px 0", marginBottom: 8 }}>
                  <div style={{ fontSize: 14, color: "var(--v-text)", lineHeight: 1.6, marginBottom: 3, display: "flex", alignItems: "flex-start", gap: 6 }}>
                    <span style={{ flex: 1 }}>{(() => { let parts = [s.en]; combineResult.words.forEach(word => { parts = parts.flatMap(part => { if (typeof part !== "string") return [part]; const split = part.split(new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")); return split.map((p, j) => p.toLowerCase() === word.toLowerCase() ? <strong key={word+j} style={{ color: "#fff", fontWeight: 700 }}>{p}</strong> : p); }); }); return parts; })()}</span>
                    <button onClick={() => speak(s.en)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, opacity: 0.5, flexShrink: 0 }} onMouseEnter={e => e.target.style.opacity = 1} onMouseLeave={e => e.target.style.opacity = 0.5}>🔊</button>
                  </div>
                  {s.sr && <div style={{ fontSize: 12, color: "var(--v-muted)", fontStyle: "italic", marginBottom: 8 }}>↳ {s.sr}</div>}
                  {savingTo?.sentenceIndex === i ? (
                    <div style={{ background: "var(--v-input)", border: "1px solid var(--v-border)", borderRadius: 8, padding: "10px 12px", marginTop: 6 }}>
                      <div style={{ fontSize: 10, letterSpacing: 2, color: "var(--v-accent)", marginBottom: 8, textTransform: "uppercase" }}>Dodaj primer za:</div>
                      {combineResult.words.map(word => { const wordObj = words.find(w => w.word === word); const checked = savingTo.selectedWordIds.includes(wordObj?.id); return wordObj ? (<div key={word} onClick={() => setSavingTo(prev => ({ ...prev, selectedWordIds: checked ? prev.selectedWordIds.filter(id => id !== wordObj.id) : [...prev.selectedWordIds, wordObj.id] }))} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", cursor: "pointer" }}><div style={{ width: 16, height: 16, borderRadius: 3, border: "2px solid " + (checked ? "var(--v-accent)" : "rgba(255,255,255,0.3)"), background: checked ? "var(--v-accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", flexShrink: 0 }}>{checked ? "✓" : ""}</div><span style={{ fontSize: 13, fontStyle: "italic", color: "var(--v-text)" }}>{word}</span><span style={{ fontSize: 11, color: "var(--v-muted)" }}>{wordObj.translation}</span></div>) : null; })}
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button onClick={() => { savingTo.selectedWordIds.forEach(wid => { setWords(prev => prev.map(w => w.id === wid ? { ...w, sentences: [...(w.sentences || []), { en: s.en, sr: s.sr }] } : w)); }); showToast(`Primer dodat ✓`); setSavingTo(null); }} disabled={savingTo.selectedWordIds.length === 0} style={{ background: savingTo.selectedWordIds.length > 0 ? "var(--v-accent)" : "var(--v-border)", border: "none", color: savingTo.selectedWordIds.length > 0 ? "#fff" : "var(--v-muted)", padding: "6px 14px", borderRadius: 6, cursor: savingTo.selectedWordIds.length > 0 ? "pointer" : "default", fontSize: 12, fontFamily: "monospace" }}>Sačuvaj</button>
                        <button onClick={() => setSavingTo(null)} style={{ background: "none", border: "1px solid var(--v-border)", color: "var(--v-muted)", padding: "6px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}>Odustani</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setSavingTo({ sentenceIndex: i, selectedWordIds: [] })} style={{ background: "none", border: "1px solid rgba(99,102,241,0.4)", color: "var(--v-accentSoft)", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "monospace", marginTop: 4 }}>+ sačuvaj primer</button>
                  )}
                </div>
              ))}
              <button onClick={() => setCombineResult(null)} style={{ background: "none", border: "none", color: "var(--v-muted)", cursor: "pointer", fontSize: 12, fontFamily: "monospace", marginTop: 4 }}>✕ zatvori</button>
            </div>
          )}

          {/* BOARD VIEW */}
          {layoutView === "board" && (
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12, alignItems: "start" }}>
              {[["new","★ Novo","#3b82f6","rgba(59,130,246,0.08)"],["learning","? Učim","#e11d48","rgba(225,29,72,0.08)"],["known","✓ Znam","#22c55e","rgba(34,197,94,0.08)"]].map(([status, label, color, bg]) => {
                const col = searchedWords.filter(w => w.status === status);
                return (
                  <div key={status} style={{ background: bg, border: "1px solid " + color + "33", borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid " + color + "33", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, fontFamily: "monospace", color: color, letterSpacing: 1 }}>{label}</span>
                      <span style={{ fontSize: 11, background: color + "22", color: color, borderRadius: 10, padding: "2px 8px", fontFamily: "monospace" }}>{col.length}</span>
                    </div>
                    <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6, minHeight: 60 }}>
                      {col.length === 0 && <div style={{ color: "var(--v-subtle)", fontSize: 12, textAlign: "center", padding: "16px 0" }}>—</div>}
                      {col.map(w => (
                        <div key={w.id} onClick={() => { setSelected(w); setView("detail"); fetchImage(w.word, w.imageUrl, w.id); }}
                          style={{ background: "var(--v-card)", border: "1px solid var(--v-border)", borderRadius: 8, padding: "10px 12px", cursor: "pointer", transition: "border-color 0.15s" }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = color + "88"}
                          onMouseLeave={e => e.currentTarget.style.borderColor = "var(--v-border)"}>
                          <div style={{ fontSize: 14, fontStyle: "italic", color: "var(--v-text)", fontWeight: "bold", marginBottom: 2 }}>{w.word}</div>
                          {w.ipa && <div style={{ fontSize: 11, color: "var(--v-accent)", fontFamily: "monospace", marginBottom: 3 }}>{w.ipa}</div>}
                          {w.translation && <div style={{ fontSize: 12, color: "var(--v-muted)" }}>{w.translation}</div>}
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
          {layoutView === "list" && (
            filteredWords.length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--v-muted)", padding: 60 }}><div style={{ fontSize: 40, marginBottom: 16 }}>📖</div><div>Nema reči. Klikni + DODAJ!</div></div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredWords.map(w => (
                  <div key={w.id} onClick={() => { if (combineMode) { setSelectedIds(prev => prev.includes(w.id) ? prev.filter(id => id !== w.id) : [...prev, w.id]); } else { setSelected(w); setView("detail"); fetchImage(w.word, w.imageUrl, w.id); } }}
                    style={{ background: combineMode && selectedIds.includes(w.id) ? "var(--v-selectedBg)" : "var(--v-card)", border: "1px solid var(--v-border)", borderLeft: "4px solid " + (combineMode && selectedIds.includes(w.id) ? "var(--v-accent)" : w.status === "known" ? "#22c55e" : w.status === "learning" ? "#e11d48" : "#3b82f6"), borderRadius: 12, padding: "12px 16px", cursor: "pointer", display: "flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", gap: 10, boxShadow: combineMode && selectedIds.includes(w.id) ? "0 0 16px rgba(129,140,248,0.4)" : "none", transition: "all 0.15s" }}
                    onMouseEnter={e => { if (!combineMode) e.currentTarget.style.opacity = "0.9"; }} onMouseLeave={e => { if (!combineMode) e.currentTarget.style.opacity = "1"; }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 0, flex: 1, minWidth: 0 }}>
                      {combineMode && <div style={{ width: 20, height: 20, borderRadius: 4, border: "2px solid " + (selectedIds.includes(w.id) ? "#818cf8" : "rgba(255,255,255,0.3)"), background: selectedIds.includes(w.id) ? "var(--v-accent)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, color: "#fff" }}>{selectedIds.includes(w.id) ? "✓" : ""}</div>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
                          <div style={{ fontSize: 17, fontStyle: "italic", fontWeight: 700, color: "var(--v-text)" }}>{w.word}</div>
                          {w.ipa && <div style={{ fontSize: 10, color: "var(--v-muted)", fontFamily: "monospace" }}>{w.ipa}</div>}
                        </div>
                        {w.translation && <div style={{ fontSize: 12, color: "var(--v-muted)" }}>{w.translation}</div>}
                      </div>
                    </div>
                    {!combineMode && (
                      <div style={{ display: "flex", gap: 5, justifyContent: "flex-end", flexShrink: 0 }}>
                        {[["★","new","#3b82f6","Novo"],["?","learning","#e11d48","Učim"],["✓","known","#22c55e","Znam"]].map(([label, s, color, tip]) => (
                          <div key={s} style={{ position: "relative" }}>
                            <button onClick={e => { e.stopPropagation(); updateStatus(w.id, s); }} style={{ background: w.status === s ? color : "transparent", border: "1px solid " + (w.status === s ? color : "rgba(255,255,255,0.2)"), color: w.status === s ? "#fff" : "rgba(255,255,255,0.25)", width: 24, height: 24, borderRadius: "50%", cursor: "pointer", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }} onMouseEnter={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }} onMouseLeave={e => { const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}>{label}</button>
                            <div className="tip" style={{ position: "absolute", bottom: 30, left: "50%", transform: "translateX(-50%)", background: "var(--v-panel)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>{tip}</div>
                          </div>
                        ))}
                        <div style={{ position: "relative" }}>
                          <button onClick={e => { e.stopPropagation(); if (window.confirm(`Obrisati "${w.word}"?`)) deleteWord(w.id); }} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "var(--v-statusInactive)", width: 24, height: 24, borderRadius: "50%", cursor: "pointer", fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }} onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "var(--v-text)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.5)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="1"; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--v-statusInactive)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)"; const t = e.currentTarget.parentNode.querySelector(".tip"); if(t) t.style.opacity="0"; }}>✕</button>
                          <div className="tip" style={{ position: "absolute", bottom: 30, left: "50%", transform: "translateX(-50%)", background: "var(--v-panel)", border: "1px solid var(--v-border)", color: "var(--v-text)", padding: "3px 8px", borderRadius: 6, fontSize: 10, whiteSpace: "nowrap", pointerEvents: "none", opacity: 0, transition: "opacity 0.15s", fontFamily: "monospace", zIndex: 999 }}>Briši</div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
          </>)}
        </div>
      )}

      {view === "list" && workspaceTab === "dictionary" && combineMode && (
        <button onClick={generateCombined} disabled={selectedIds.length < 2 || combineLoading} style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", background: selectedIds.length >= 2 ? "var(--v-accent)" : "var(--v-border)", border: "none", color: selectedIds.length >= 2 ? "#fff" : "var(--v-muted)", padding: "14px 36px", borderRadius: 50, cursor: selectedIds.length >= 2 ? "pointer" : "default", fontSize: 15, fontFamily: "monospace", letterSpacing: 1, boxShadow: selectedIds.length >= 2 ? "0 4px 24px rgba(99,102,241,0.5)" : "none", zIndex: 100, whiteSpace: "nowrap", transition: "all 0.2s" }}>
          {combineLoading ? "⟳ Generišem..." : selectedIds.length < 2 ? `Označi min. 2 reči (${selectedIds.length})` : `⊕ Generiši primere (${selectedIds.length})`}
        </button>
      )}

      <style>{`.vocab-practice-page { font-family: Georgia, serif; }
.v51-modes {display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:30px}
.v51-mode-buttons {display:flex;flex-wrap:wrap;gap:10px}
.v51-mode {border:1px solid var(--v-border);background:var(--v-panel);color:var(--v-text);border-radius:24px;padding:14px 22px;font-size:16px;font-weight:650;cursor:pointer}
.v51-mode.active,.v51-primary {background:var(--v-accent);color:var(--v-accentText);border-color:var(--v-accent)}
.v51-goal-controls {display:flex;gap:9px;align-items:center;font-size:14px;font-family:Arial,sans-serif;color:var(--v-text)}
.v51-goal-controls label {border:1px solid var(--v-border);border-right:0;background:var(--v-panel);padding:12px 2px 12px 15px;border-radius:12px 0 0 12px;white-space:nowrap}
.v51-goal-controls select {border:1px solid var(--v-border);border-left:0;border-radius:0 12px 12px 0;background:var(--v-panel);color:var(--v-text);padding:12px 9px;margin-left:-9px;font-weight:700}
.v51-goal-controls strong{white-space:nowrap}
.v51-top-progress,.v51-progress-bar{height:14px;background:var(--v-elevated);border-radius:20px;overflow:hidden}
.v51-top-progress{width:140px}
.v51-top-progress span,.v51-progress-bar span{display:block;height:100%;border-radius:20px;background:linear-gradient(90deg,#10a763,#28c87a);transition:width .3s}
.v51-practice-grid{display:grid;grid-template-columns:minmax(245px,.95fr) minmax(380px,1.72fr) minmax(270px,.99fr);gap:20px;align-items:start}
.v51-pane,.v51-flashcard,.v51-explanation{background:var(--v-panel);border:1px solid var(--v-border);border-radius:20px;box-shadow:0 9px 26px rgba(31,78,137,.055)}
.v51-pane{padding:22px}
.v51-pane-title{display:flex;align-items:center;gap:14px;margin-bottom:23px}
.v51-pane-title b{display:block;font-size:22px;line-height:1.14;color:var(--v-text)}
.v51-pane-title small{display:block;font-size:13px;color:var(--v-muted);margin-top:5px}
.v51-icon{width:48px;height:48px;flex-shrink:0;display:grid;place-items:center;border-radius:14px;background:var(--v-elevated);color:var(--v-accent);font-size:26px}
.v51-stat{display:flex;align-items:center;gap:14px;border:1px solid var(--v-border);border-radius:14px;background:var(--v-card);padding:13px 14px;margin-bottom:10px}
.v51-stat small,.v51-stat strong{display:block}
.v51-stat small{font-size:15px;color:var(--v-muted);margin-bottom:5px}
.v51-stat strong{font-size:30px;line-height:1.1;color:var(--v-text)}
.v51-stat-icon{width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-size:27px;flex-shrink:0}
.v51-stat-icon.blue {color:#197ce8;background:#e9f3ff}.v51-stat-icon.green{color:#13a46a;background:#e5f7ec}.v51-stat-icon.purple{color:#7055df;background:#f0edff}
.v51-progress-section{margin:28px 0 25px}
.v51-progress-head{display:flex;justify-content:space-between;align-items:center;font-size:17px;margin-bottom:14px}
.v51-progress-bar{height:17px}
.v51-next-date{display:flex;gap:13px;align-items:center;background:var(--v-elevated);border-radius:14px;padding:14px 12px}
.v51-next-date b,.v51-next-date small{display:block}.v51-next-date b{font-size:15px}.v51-next-date small{font-size:13px;color:var(--v-muted);margin-top:5px}
.v51-middle{min-width:0}
.v51-flashcard{border:2px solid var(--v-accent);padding:22px 25px 24px;min-height:410px;display:flex;flex-direction:column}
.v51-card-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.v51-counter,.v51-card-mode{background:var(--v-elevated);color:var(--v-accentSoft);border-radius:30px;padding:9px 17px;font:700 14px Arial,sans-serif}
.v51-card-mode{font-size:13px}.v51-star{font-size:29px;width:42px;height:42px;border:1px solid var(--v-border);border-radius:50%;text-align:center;line-height:38px;color:var(--v-muted)}
.v51-word{text-align:center;margin:22px 0 16px}.v51-word-line{display:flex;align-items:center;justify-content:center;gap:18px}.v51-word h2{font-size:clamp(35px,4vw,58px);font-weight:700;font-style:italic;line-height:1.16;margin:0;overflow-wrap:anywhere}.v51-ipa{font:16px monospace;color:var(--v-muted);margin-top:10px}
.v51-sound{border:none;border-radius:50%;background:var(--v-elevated);color:var(--v-accent);font-size:19px;width:53px;height:53px;cursor:pointer;flex-shrink:0}
.v51-question{text-align:center;margin:15px 0 25px}.v51-question p{font-size:18px;color:var(--v-muted);margin:8px 0 24px}
.v51-reveal{border:0;border-radius:26px;padding:14px 35px;background:linear-gradient(110deg,#ffad19,#de7900);color:#fff;font-size:17px;font-weight:700;box-shadow:0 6px 17px rgba(212,126,14,.2);cursor:pointer}
.v51-revealed{display:flex;flex-direction:column;gap:14px;margin:8px 0 16px}
.v51-answer{background:linear-gradient(100deg,#dff7e9,#cdf4df);color:#075b39;font-size:28px;font-weight:bold;text-align:center;border-radius:13px;padding:16px 12px;overflow-wrap:anywhere}
.v51-example{display:flex;gap:17px;padding:15px 6px;color:var(--v-text)}.v51-example>span{color:var(--v-accent);font-size:34px;font-weight:bold;line-height:1}.v51-example strong{color:var(--v-accent);font:700 14px Arial,sans-serif}.v51-example-en{font-size:17px;font-weight:700;font-style:italic;margin:5px 0}.v51-example small{color:var(--v-muted);font-size:14px}
.v51-rating-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.v51-rating{display:flex;flex-direction:column;gap:6px;align-items:center;border-radius:13px;padding:13px 4px;cursor:pointer;min-width:0}.v51-rating b{font-size:15px;white-space:nowrap}.v51-rating small{font-size:12px;color:var(--v-text)}.v51-rating.bad{background:#fff0f3;color:#d71937;border:1px solid #fb5672}.v51-rating.hard{background:#fff7e6;color:#d77700;border:1px solid #ffad19}.v51-rating.good{background:#e6f8ef;color:#087c48;border:1px solid #25b66b}
.v51-card-bottom{display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap;border-top:1px solid var(--v-border);margin-top:auto;padding-top:20px}.v51-card-bottom button,.v51-below-card button,.v51-outline{color:var(--v-accentSoft);background:var(--v-card);border:1px solid var(--v-border);border-radius:12px;padding:10px 16px;cursor:pointer;font-size:13px;font-weight:700}
.v51-below-card{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px}.v51-below-card button{background:var(--v-panel);border-radius:25px}.v51-below-card button:disabled{opacity:.4;cursor:not-allowed}.v51-dots{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}.v51-dots i{display:block;background:var(--v-border);border-radius:100%;width:9px;height:9px}.v51-dots i.on{background:#13b36c}
.v51-queue-row{display:flex;align-items:center;gap:12px;width:100%;background:var(--v-card);border:1px solid var(--v-border);border-radius:13px;padding:15px 12px;margin-top:6px;margin-bottom:8px;cursor:pointer;text-align:left;color:var(--v-text)}.v51-queue-num{display:grid;place-items:center;background:var(--v-elevated);height:37px;width:37px;flex-shrink:0;border-radius:50%;font:700 15px Arial,sans-serif}.v51-queue-label{flex:1;min-width:0}.v51-queue-label b{display:block;font-size:21px;font-style:italic;overflow-wrap:anywhere}.v51-queue-label small{font:13px monospace;color:var(--v-muted);display:block;margin-top:4px}.v51-status{font:700 12px Arial,sans-serif;border-radius:22px;padding:8px 10px;white-space:nowrap}.v51-status.learning{background:#fae4e9;color:#be173e}.v51-status.known{background:#e1f0ff;color:#1771be}.v51-status.new{background:#eee6ff;color:#6748ca}.v51-empty{font-size:13px;color:var(--v-muted)}
.v51-explanation{margin-top:26px;padding:14px 20px;display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:center}.v51-explanation>div:first-child{display:flex;gap:14px;align-items:center}.v51-explanation b,.v51-explanation small{display:block}.v51-explanation b{font-size:15px}.v51-explanation small{font-size:12px;color:var(--v-muted);margin-top:5px}.v51-explanation>div:last-child{border-left:1px solid var(--v-border);padding-left:22px}.v51-explanation>div:last-child>span{display:flex;gap:7px;flex-wrap:wrap;margin-top:7px}.v51-explanation em{font:12px Arial,sans-serif;background:var(--v-elevated);color:var(--v-muted);border-radius:20px;padding:7px 10px;font-style:normal}
.v51-finished{text-align:center;align-items:center;justify-content:center;gap:12px}.v51-finished-emoji{font-size:45px}.v51-finished h2{margin:0}.v51-finished p{color:var(--v-muted);max-width:450px;line-height:1.6}.v51-primary{border:0;border-radius:10px;padding:12px 25px;cursor:pointer;font-weight:700}
@media(max-width:1150px){.v51-practice-grid{grid-template-columns:minmax(215px,.9fr) minmax(330px,1.5fr)}.v51-right{grid-column:1/-1}.v51-queue-row{display:inline-flex;width:calc(50% - 8px);vertical-align:top;margin-right:8px}.v51-goal-controls{margin-left:0}}
@media(max-width:780px){.v51-practice-grid{grid-template-columns:1fr}.v51-right{grid-column:auto}.v51-mode{padding:12px 14px;font-size:14px}.v51-queue-row{display:flex;width:100%;margin-right:0}.v51-explanation{grid-template-columns:1fr}.v51-explanation>div:last-child{border:0;border-top:1px solid var(--v-border);padding:15px 0 0}.v51-left{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.v51-left .v51-pane-title,.v51-left .v51-progress-section,.v51-left .v51-next-date{grid-column:1/-1}.v51-stat{padding:8px;gap:6px}.v51-stat-icon{height:32px;width:32px;font-size:17px}.v51-stat small{font-size:11px}.v51-stat strong{font-size:22px}}
@media(max-width:520px){.v51-left{grid-template-columns:1fr}.v51-modes{gap:14px}.v51-goal-controls{flex-wrap:wrap}.v51-top-progress{width:85px}.v51-flashcard{padding:17px 13px}.v51-card-mode{display:none}.v51-rating-grid{gap:5px}.v51-rating b{font-size:12px}.v51-rating small{font-size:10px}.v51-card-bottom button{padding:9px 8px;font-size:11px}.v51-dots{display:none}.v51-pane{padding:16px}}
`}</style>
      <style>{`* { outline: none; } input, textarea { transition: border-color 0.2s; } input:focus, textarea:focus { border-color: var(--v-accent) !important; } input::placeholder, textarea::placeholder { color: var(--v-subtle); } select { color-scheme: inherit; } button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--v-accent) !important; outline-offset: 2px; } button { transition: filter .16s ease, background .16s ease; } button:hover { filter: brightness(1.04); } @media(max-width: 1050px) { .vocab-practice-grid { grid-template-columns: 1fr !important; } .vocab-practice-grid > aside:first-child { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; } .vocab-practice-grid > aside:first-child > .vocab-practice-stat { margin-bottom: 0 !important; } .vocab-practice-grid > aside:first-child > div:last-child { grid-column: 1 / -1; } } @media(max-width: 720px) { .vocab-practice-grid > aside:first-child { grid-template-columns: 1fr; } .vocab-practice-footer { justify-content: center !important; } .vocab-stat-grid { grid-template-columns: repeat(2, minmax(0,1fr)) !important; } .vocab-hero-grid { grid-template-columns: 1fr !important; } .vocab-toolbar > input { flex-basis: 100% !important; } }`}</style>
    </div>
  );
}
